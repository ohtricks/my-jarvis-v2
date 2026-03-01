// Jarvis Browser Bridge — Service Worker
// Conecta ao Jarvis via Socket.IO e executa comandos no Chrome

importScripts('lib/socket.io.min.js');

const JARVIS_URL = 'http://localhost:8000';
const RECONNECT_INTERVAL_MS = 5000;

let socket = null;
let connected = false;

// ── Conexão Socket.IO ────────────────────────────────────────────────────────

function connect() {
    if (socket) {
        socket.disconnect();
    }

    socket = io(JARVIS_URL, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: Infinity,
        reconnectionDelay: RECONNECT_INTERVAL_MS,
    });

    socket.on('connect', () => {
        connected = true;
        console.log('[Jarvis Bridge] Conectado ao Jarvis:', socket.id);
        socket.emit('extension_register', { version: '1.0' });
        updateBadge(true);
    });

    socket.on('disconnect', () => {
        connected = false;
        console.log('[Jarvis Bridge] Desconectado do Jarvis');
        updateBadge(false);
    });

    socket.on('extension_task_status', (data) => {
        // Salva no storage para o popup ler em tempo real
        chrome.storage.local.set({ extension_task: data });
    });

    socket.on('extension_command', async (data) => {
        console.log('[Jarvis Bridge] Comando recebido:', data.command, data.args);
        try {
            const result = await handleCommand(data.command, data.args || {});
            socket.emit('extension_result', {
                request_id: data.request_id,
                result: result,
                error: null,
            });
        } catch (err) {
            console.error('[Jarvis Bridge] Erro ao executar comando:', err);
            socket.emit('extension_result', {
                request_id: data.request_id,
                result: null,
                error: err.message || String(err),
            });
        }
    });
}

function updateBadge(isConnected) {
    chrome.action.setBadgeText({ text: isConnected ? '●' : '○' });
    chrome.action.setBadgeBackgroundColor({ color: isConnected ? '#22c55e' : '#6b7280' });
}

// ── Dispatcher de Comandos ───────────────────────────────────────────────────

async function handleCommand(command, args) {
    switch (command) {
        case 'list_tabs':       return await listTabs(args);
        case 'get_tab_content': return await getTabContent(args);
        case 'navigate':        return await navigate(args);
        case 'click_element':   return await clickElement(args);
        case 'fill_input':      return await fillInput(args);
        case 'scroll_page':     return await scrollPage(args);
        case 'get_active_tab':  return await getActiveTab();
        default:
            throw new Error(`Comando desconhecido: ${command}`);
    }
}

// ── Implementações dos Comandos ──────────────────────────────────────────────

async function listTabs(args) {
    const queryOpts = {};
    if (args.url_pattern) queryOpts.url = args.url_pattern;
    if (args.title)       queryOpts.title = args.title;

    const tabs = await chrome.tabs.query(queryOpts);
    return tabs.map(t => ({
        id:    t.id,
        url:   t.url,
        title: t.title,
        active: t.active,
    }));
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Nenhuma aba ativa encontrada');
    return { id: tab.id, url: tab.url, title: tab.title };
}

async function getTabContent(args) {
    const tabId = await resolveTabId(args);

    // Garante que a aba está carregada
    await waitForTab(tabId);

    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractPageContent,
        args: [args.selector || null],
    });

    const content = results[0]?.result;
    if (!content) throw new Error('Não foi possível extrair conteúdo da aba');
    return content;
}

async function navigate(args) {
    if (!args.url) throw new Error('URL é obrigatória para navigate');

    if (args.tab_id) {
        // Navega em aba existente
        await chrome.tabs.update(args.tab_id, { url: args.url });
        await waitForTab(args.tab_id);
        return { tab_id: args.tab_id, url: args.url };
    } else {
        // Abre nova aba
        const tab = await chrome.tabs.create({ url: args.url });
        await waitForTab(tab.id);
        return { tab_id: tab.id, url: args.url };
    }
}

async function clickElement(args) {
    const tabId = await resolveTabId(args);
    if (!args.selector) throw new Error('selector é obrigatório para click_element');

    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector) => {
            const el = document.querySelector(selector);
            if (!el) return { success: false, error: `Elemento não encontrado: ${selector}` };
            el.click();
            return { success: true };
        },
        args: [args.selector],
    });

    return results[0]?.result || { success: false, error: 'Script sem resultado' };
}

async function fillInput(args) {
    const tabId = await resolveTabId(args);
    if (!args.selector) throw new Error('selector é obrigatório para fill_input');
    if (args.text === undefined) throw new Error('text é obrigatório para fill_input');

    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector, text) => {
            const el = document.querySelector(selector);
            if (!el) return { success: false, error: `Elemento não encontrado: ${selector}` };
            el.focus();
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true };
        },
        args: [args.selector, args.text],
    });

    return results[0]?.result || { success: false, error: 'Script sem resultado' };
}

async function scrollPage(args) {
    const tabId = await resolveTabId(args);
    const direction = args.direction || 'down';
    const amount    = args.amount    || 500;

    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (direction, amount) => {
            const delta = direction === 'up' ? -amount : amount;
            window.scrollBy({ top: delta, behavior: 'smooth' });
            return { success: true, scrollY: window.scrollY };
        },
        args: [direction, amount],
    });

    return results[0]?.result || { success: false };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveTabId(args) {
    if (args.tab_id) return args.tab_id;

    // Tenta encontrar aba pela URL
    if (args.url_pattern) {
        const tabs = await chrome.tabs.query({ url: args.url_pattern });
        if (tabs.length > 0) return tabs[0].id;
    }

    // Fallback: aba ativa
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Nenhuma aba encontrada');
    return tab.id;
}

function waitForTab(tabId, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        function checkTab() {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
                if (tab.status === 'complete') {
                    resolve(tab);
                } else if (Date.now() - start > timeoutMs) {
                    resolve(tab); // Timeout: continua mesmo sem estar 100% carregado
                } else {
                    setTimeout(checkTab, 300);
                }
            });
        }

        checkTab();
    });
}

// Função injetada na página para extrair conteúdo legível
function extractPageContent(selector) {
    try {
        if (selector) {
            const el = document.querySelector(selector);
            return el ? el.innerText.trim().slice(0, 50000) : null;
        }

        // Remove elementos que poluem o texto
        const noise = ['script', 'style', 'noscript', 'svg', 'img', 'video',
                       'nav', 'footer', 'header', 'aside', '[role="banner"]',
                       '[role="navigation"]', '[role="complementary"]',
                       '.cookie-banner', '#cookie', '.ad', '.advertisement'];

        const clone = document.body.cloneNode(true);
        noise.forEach(sel => {
            clone.querySelectorAll(sel).forEach(el => el.remove());
        });

        const text = clone.innerText
            .replace(/\n{3,}/g, '\n\n')  // colapsa linhas em branco
            .trim()
            .slice(0, 50000);

        return {
            text,
            url:   window.location.href,
            title: document.title,
            chars: text.length,
        };
    } catch (e) {
        return { text: document.body.innerText.slice(0, 50000), url: window.location.href, title: document.title };
    }
}

// ── Init ─────────────────────────────────────────────────────────────────────

connect();

// Reconecta se o service worker acordar depois de ficar dormindo
chrome.runtime.onStartup.addListener(connect);
