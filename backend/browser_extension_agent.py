"""
BrowserExtensionAgent
---------------------
Controla o Chrome do usuário via Chrome Extension Bridge.
Usa Gemini Flash (só texto, sem screenshots) — muito mais barato que Computer Use.

Fluxo:
  Jarvis chama run_task(prompt)
      → loop multi-turno com Gemini Flash
          → Flash decide qual comando executar (list_tabs, get_tab_content, navigate, etc.)
          → send_command() emite para a extensão via Socket.IO e aguarda resposta (asyncio.Future)
          → extensão executa no Chrome real e devolve resultado
          → Flash processa e decide próximo passo
      → retorna resposta final em texto
"""

import asyncio
import uuid
import os
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")

MODEL = "gemini-2.0-flash"

SYSTEM_PROMPT = """Você é o Jarvis, um assistente de IA que controla o navegador Chrome do usuário.
Você tem acesso às abas abertas do Chrome do usuário (incluindo sites onde ele já está logado, como Gmail, Outlook, etc.).

Use as ferramentas disponíveis para:
- Listar e encontrar abas abertas
- Ler o conteúdo de páginas
- Navegar para URLs
- Clicar em elementos e preencher formulários

Sempre responda em português brasileiro.
Seja conciso e direto. Quando tiver os dados necessários, responda sem executar mais ações.
"""

# Definição das ferramentas disponíveis para o Flash
BROWSER_TOOLS = [
    types.Tool(function_declarations=[
        types.FunctionDeclaration(
            name="list_tabs",
            description="Lista todas as abas abertas no Chrome. Use para encontrar a aba correta antes de ler seu conteúdo.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "url_pattern": types.Schema(type="STRING", description="Padrão de URL para filtrar (opcional). Ex: '*gmail*', '*outlook*'"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="get_tab_content",
            description="Lê o conteúdo de texto de uma aba. Retorna o texto visível da página (sem HTML).",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "tab_id": types.Schema(type="INTEGER", description="ID da aba (obtido via list_tabs)"),
                    "selector": types.Schema(type="STRING", description="Seletor CSS opcional para extrair só uma parte da página. Ex: '.email-list', '#main-content'"),
                },
                required=["tab_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="navigate",
            description="Navega para uma URL. Abre nova aba se tab_id não for informado.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "url":    types.Schema(type="STRING",  description="URL completa para navegar"),
                    "tab_id": types.Schema(type="INTEGER", description="ID da aba existente para navegar (opcional)"),
                },
                required=["url"],
            ),
        ),
        types.FunctionDeclaration(
            name="click_element",
            description="Clica em um elemento da página usando seletor CSS.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "tab_id":   types.Schema(type="INTEGER", description="ID da aba"),
                    "selector": types.Schema(type="STRING",  description="Seletor CSS do elemento a clicar"),
                },
                required=["tab_id", "selector"],
            ),
        ),
        types.FunctionDeclaration(
            name="fill_input",
            description="Preenche um campo de texto na página.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "tab_id":   types.Schema(type="INTEGER", description="ID da aba"),
                    "selector": types.Schema(type="STRING",  description="Seletor CSS do input"),
                    "text":     types.Schema(type="STRING",  description="Texto a preencher"),
                },
                required=["tab_id", "selector", "text"],
            ),
        ),
        types.FunctionDeclaration(
            name="scroll_page",
            description="Rola a página para cima ou para baixo.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "tab_id":    types.Schema(type="INTEGER", description="ID da aba"),
                    "direction": types.Schema(type="STRING",  description="'up' ou 'down'"),
                    "amount":    types.Schema(type="INTEGER", description="Pixels para rolar (padrão: 500)"),
                },
                required=["tab_id"],
            ),
        ),
    ])
]


class BrowserExtensionAgent:
    def __init__(self, emit_fn, status_fn=None):
        """
        emit_fn:   async (data: dict) — envia comando para a extensão Chrome.
        status_fn: async (label: str, progress: float, active: bool) — atualiza popup da extensão.
        """
        self._emit      = emit_fn
        self._status_fn = status_fn
        self._pending: dict[str, asyncio.Future] = {}
        self._client = genai.Client(api_key=API_KEY)

    # ── Comunicação com a extensão ──────────────────────────────────────────

    async def send_command(self, command: str, args: dict = {}) -> dict:
        """Envia comando para extensão e aguarda resposta (máx 15s)."""
        request_id = str(uuid.uuid4())
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self._pending[request_id] = future

        await self._emit({
            "command":    command,
            "args":       args,
            "request_id": request_id,
        })

        try:
            return await asyncio.wait_for(future, timeout=15.0)
        except asyncio.TimeoutError:
            self._pending.pop(request_id, None)
            raise TimeoutError(f"Extensão não respondeu ao comando '{command}' em 15s")

    def resolve(self, request_id: str, result, error=None):
        """Chamado pelo server.py quando a extensão devolve o resultado."""
        fut = self._pending.pop(request_id, None)
        if fut and not fut.done():
            if error:
                fut.set_exception(RuntimeError(error))
            else:
                fut.set_result(result)

    # ── Labels amigáveis por ação ────────────────────────────────────────────

    _ACTION_LABELS = {
        "list_tabs":       "Procurando abas...",
        "get_tab_content": "Lendo conteúdo da página...",
        "navigate":        "Navegando...",
        "click_element":   "Clicando...",
        "fill_input":      "Preenchendo campo...",
        "scroll_page":     "Rolando página...",
        "get_active_tab":  "Verificando aba ativa...",
    }

    # ── Loop principal ──────────────────────────────────────────────────────

    async def run_task(self, prompt: str, update_callback=None) -> str:
        """
        Executa uma tarefa no Chrome usando Gemini Flash + ferramentas de tab.
        update_callback(image=None, log_text) para status updates no painel do Jarvis.
        status_fn é chamado separadamente para atualizar o popup da extensão.
        """
        max_turns = 10

        # Label curto do prompt (máx 45 chars) para mostrar no popup
        short_prompt = prompt[:45].rstrip() + ("..." if len(prompt) > 45 else "")

        async def log(msg: str):
            print(f"[BrowserExtAgent] {msg}")
            if update_callback:
                await update_callback(None, msg)

        async def push_status(label: str, progress: float, active: bool = True):
            if self._status_fn:
                await self._status_fn(label, progress, active)

        await log(f"Iniciando tarefa: {prompt}")
        await push_status(short_prompt, 0.0)

        history = []
        history.append(types.Content(
            role="user",
            parts=[types.Part(text=prompt)],
        ))

        for turn in range(max_turns):
            progress_base = turn / max_turns

            await push_status(short_prompt, progress_base + 0.02)

            response = await self._client.aio.models.generate_content(
                model=MODEL,
                contents=history,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    tools=BROWSER_TOOLS,
                    temperature=0.1,
                ),
            )

            candidate = response.candidates[0]
            history.append(types.Content(role="model", parts=candidate.content.parts))

            fn_calls = [p for p in candidate.content.parts if p.function_call]

            if not fn_calls:
                # Resposta final
                final_text = "".join(
                    p.text for p in candidate.content.parts if hasattr(p, "text") and p.text
                )
                await log(f"Concluído em {turn + 1} turno(s).")
                await push_status("Concluído", 1.0, active=False)
                return final_text

            # Executar cada function call
            fn_responses = []
            for i, part in enumerate(fn_calls):
                fc   = part.function_call
                name = fc.name
                args = dict(fc.args) if fc.args else {}

                action_label = self._ACTION_LABELS.get(name, f"{name}...")
                action_progress = progress_base + ((i + 1) / len(fn_calls)) * (1 / max_turns)

                await log(f"Executando: {name}({args})")
                await push_status(action_label, min(action_progress, 0.95))

                try:
                    result = await self.send_command(name, args)
                    result_str = str(result)
                    await log(f"  → {result_str[:200]}")
                except Exception as e:
                    result_str = f"ERRO: {e}"
                    await log(f"  → {result_str}")

                fn_responses.append(types.Part(
                    function_response=types.FunctionResponse(
                        name=name,
                        response={"result": result_str},
                    )
                ))

            history.append(types.Content(role="user", parts=fn_responses))

        await push_status("Limite atingido", 1.0, active=False)
        return "Limite de turnos atingido sem uma resposta final."
