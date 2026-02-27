import asyncio
import base64
import io
import os
import traceback

import mss
import mss.tools
import PIL.Image
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

MODEL_ID = "gemini-2.5-computer-use-preview-10-2025"


class MacAgent:
    def __init__(self):
        self.client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

    def _capture_screen(self) -> tuple[bytes, int, int]:
        """Capture Mac screen. Returns (png_bytes, width, height)."""
        with mss.mss() as sct:
            monitor = sct.monitors[1]  # Primary monitor
            screenshot = sct.grab(monitor)
            width, height = screenshot.width, screenshot.height
            # Use PIL for reliable PNG encoding (more compatible than mss.tools.to_png)
            img = PIL.Image.frombytes('RGB', screenshot.size, screenshot.rgb)
            buf = io.BytesIO()
            img.save(buf, format='PNG')
            return buf.getvalue(), width, height

    def _execute_action(self, fn_name: str, args: dict, width: int, height: int):
        """Execute mouse/keyboard action. Coordinates normalized 0-1000."""
        # Lazy import pyautogui so server starts even if not installed
        import pyautogui
        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.1

        def dx(x): return int((x / 1000) * width)
        def dy(y): return int((y / 1000) * height)

        if fn_name == "click_at":
            pyautogui.click(dx(args["x"]), dy(args["y"]))

        elif fn_name == "double_click_at":
            pyautogui.doubleClick(dx(args["x"]), dy(args["y"]))

        elif fn_name == "right_click_at":
            pyautogui.rightClick(dx(args["x"]), dy(args["y"]))

        elif fn_name == "hover_at":
            pyautogui.moveTo(dx(args["x"]), dy(args["y"]))

        elif fn_name == "type_text_at":
            if args.get("x") is not None and args.get("y") is not None:
                pyautogui.click(dx(args["x"]), dy(args["y"]))
            if args.get("clear_before_typing"):
                pyautogui.hotkey("command", "a")
            pyautogui.write(args.get("text", ""), interval=0.03)
            if args.get("press_enter"):
                pyautogui.press("enter")

        elif fn_name == "key_combination":
            keys = []
            for k in args.get("keys", []):
                k = k.lower()
                if k in ("ctrl", "control"):
                    k = "ctrl"
                elif k in ("cmd", "command", "meta"):
                    k = "command"
                elif k in ("opt", "option", "alt"):
                    k = "option"
                keys.append(k)
            pyautogui.hotkey(*keys)

        elif fn_name == "scroll_at":
            x, y = dx(args.get("x", 500)), dy(args.get("y", 500))
            amount = args.get("amount", 3)
            pyautogui.scroll(amount, x=x, y=y)

        elif fn_name == "drag_and_drop":
            sx, sy = dx(args["start_x"]), dy(args["start_y"])
            ex, ey = dx(args["end_x"]), dy(args["end_y"])
            pyautogui.moveTo(sx, sy)
            pyautogui.dragTo(ex, ey, duration=0.5, button="left")

        elif fn_name == "open_application":
            app_name = args.get("app_name", "")
            os.system(f'open -a "{app_name}"')

        elif fn_name == "open_url":
            url = args.get("url", "")
            os.system(f'open "{url}"')

    async def run_task(self, prompt: str, update_callback=None) -> str:
        """Main loop: screenshot → Gemini Computer Use → action → repeat."""
        MAX_TURNS = 25

        print(f"[MAC AGENT] Starting task: {prompt}")

        try:
            img_bytes, width, height = self._capture_screen()
        except Exception as e:
            msg = f"Erro ao capturar tela: {e}\nVerifique permissão de Screen Recording em System Settings → Privacy."
            print(f"[MAC AGENT] {msg}")
            traceback.print_exc()
            if update_callback:
                await update_callback(None, f"[MAC ERRO] {msg}")
            return msg

        img_b64 = base64.b64encode(img_bytes).decode()

        if update_callback:
            await update_callback(img_b64, f"[MAC] Iniciando: {prompt}")

        contents = [
            types.Content(role="user", parts=[
                types.Part(text=prompt),
                types.Part(inline_data=types.Blob(mime_type="image/png", data=img_bytes))
            ])
        ]

        for turn in range(MAX_TURNS):
            print(f"[MAC AGENT] Turn {turn + 1}/{MAX_TURNS}")

            try:
                response = await self.client.aio.models.generate_content(
                    model=MODEL_ID,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=(
                            "Você está controlando um Mac. Use as ferramentas para executar a tarefa. "
                            "Analise cada screenshot antes de agir. "
                            "Responda em português do Brasil."
                        ),
                    )
                )
            except Exception as e:
                msg = f"Erro na API Gemini: {e}"
                print(f"[MAC AGENT] {msg}")
                traceback.print_exc()
                if update_callback:
                    await update_callback(img_b64, f"[MAC ERRO] {msg}")
                return msg

            candidate = response.candidates[0]

            # Log thoughts
            for part in candidate.content.parts:
                if hasattr(part, "thought") and part.thought and part.text:
                    log = f"[MAC] Pensando: {part.text[:150]}"
                    print(log)
                    if update_callback:
                        await update_callback(img_b64, log)

            # Extract function calls
            function_calls = [
                p.function_call for p in candidate.content.parts
                if hasattr(p, "function_call") and p.function_call
            ]

            if not function_calls:
                final_text = response.text or "Tarefa concluída."
                print(f"[MAC AGENT] Finished: {final_text}")
                if update_callback:
                    await update_callback(img_b64, f"[MAC] Concluído: {final_text}")
                return final_text

            # Execute actions
            function_responses = []
            for fc in function_calls:
                fn_name = fc.name
                args = dict(fc.args) if fc.args else {}
                log = f"[MAC] {fn_name}({args})"
                print(log)

                if update_callback:
                    await update_callback(img_b64, log)

                try:
                    self._execute_action(fn_name, args, width, height)
                except ImportError:
                    msg = "[MAC ERRO] pyautogui não instalado. Execute: pip install pyautogui"
                    print(msg)
                    if update_callback:
                        await update_callback(img_b64, msg)
                    return msg
                except Exception as e:
                    err_str = str(e).lower()
                    if "not trusted" in err_str or "accessibility" in err_str or "axuielement" in err_str:
                        msg = ("[MAC ERRO] Python não tem permissão de Acessibilidade. "
                               "Acesse: System Settings → Privacy & Security → Accessibility → adicione o Python.")
                    else:
                        msg = f"[MAC ERRO] {fn_name}: {e}"
                    print(f"[MAC AGENT] Action error ({fn_name}): {e}")
                    traceback.print_exc()
                    if update_callback:
                        await update_callback(img_b64, msg)

                await asyncio.sleep(0.8)

                try:
                    img_bytes, width, height = self._capture_screen()
                    img_b64 = base64.b64encode(img_bytes).decode()
                    if update_callback:
                        await update_callback(img_b64, log)
                except Exception as e:
                    print(f"[MAC AGENT] Screenshot error: {e}")

                function_responses.append(
                    types.Part(
                        function_response=types.FunctionResponse(
                            id=fc.id,
                            name=fc.name,
                            response={
                                "output": "Action executed.",
                                "screenshot": {
                                    "data": img_bytes,
                                    "mime_type": "image/png"
                                }
                            }
                        )
                    )
                )

            contents.append(candidate.content)
            contents.append(types.Content(role="user", parts=function_responses))

        return "Limite de turnos atingido."
