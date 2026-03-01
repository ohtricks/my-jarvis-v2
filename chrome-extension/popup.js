const dot          = document.getElementById('dot');
const connLabel    = document.getElementById('conn-label');
const hint         = document.getElementById('hint');
const taskBox      = document.getElementById('task-box');
const taskLabel    = document.getElementById('task-label');
const progressFill = document.getElementById('progress-fill');
const progressPct  = document.getElementById('progress-pct');

// ── Atualiza o bloco de tarefa ──────────────────────────────────────────────
function applyTask(task) {
    if (!task) {
        taskBox.classList.remove('visible');
        return;
    }

    const pct = Math.round((task.progress || 0) * 100);

    taskBox.classList.add('visible');
    taskLabel.textContent    = task.label || '—';
    progressFill.style.width = pct + '%';
    progressPct.textContent  = pct + '%';

    if (task.active) {
        progressFill.classList.add('pulse');
    } else {
        progressFill.classList.remove('pulse');
    }
}

// ── Estado de conexão ───────────────────────────────────────────────────────
function applyConnection(isConnected) {
    if (isConnected) {
        dot.classList.add('connected');
        connLabel.textContent = 'Conectado ao Jarvis';
        hint.textContent      = '';
    } else {
        dot.classList.remove('connected');
        connLabel.textContent = 'Desconectado';
        hint.textContent      = 'Inicie o Jarvis (npm run dev) e recarregue a extensão.';
        taskBox.classList.remove('visible');
    }
}

// ── Leitura inicial do storage ──────────────────────────────────────────────
chrome.action.getBadgeText({}, (text) => {
    const connected = text === '●';
    applyConnection(connected);
});

chrome.storage.local.get(['extension_task'], (result) => {
    if (result.extension_task) {
        applyTask(result.extension_task);
    }
});

// ── Atualização em tempo real (storage.onChanged) ───────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.extension_task) {
        applyTask(changes.extension_task.newValue);
    }
});
