import { useEffect, useRef, useState } from 'react';

/**
 * PerformanceMonitor — overlay de diagnóstico de performance.
 * Toggle: Ctrl+P
 *
 * Métricas exibidas:
 *  - FPS atual (via requestAnimationFrame)
 *  - Socket.IO events/s (via socket.onAny)
 *  - Renders/s do componente pai (via renderCount prop)
 *  - JS Heap usado (performance.memory, disponível no Chromium/Electron)
 */
export default function PerformanceMonitor({ socket, renderCount }) {
    const [visible, setVisible] = useState(false);
    const [metrics, setMetrics] = useState({ fps: 0, eventsPerSec: 0, rendersPerSec: 0, heapMB: 0 });

    // Counters acumulados (refs = sem re-render)
    const frameCount = useRef(0);
    const lastFrameTime = useRef(performance.now());
    const eventCount = useRef(0);
    const lastRenderCount = useRef(renderCount?.current ?? 0);

    // RAF loop para FPS
    useEffect(() => {
        if (!visible) return;

        let rafId;
        const tick = (now) => {
            frameCount.current++;
            lastFrameTime.current = now;
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [visible]);

    // Socket.IO event counter
    useEffect(() => {
        if (!visible || !socket) return;

        const handler = () => { eventCount.current++; };
        socket.onAny(handler);
        return () => socket.offAny(handler);
    }, [visible, socket]);

    // Ticker de 1 segundo para atualizar o display
    useEffect(() => {
        if (!visible) return;

        const id = setInterval(() => {
            const now = performance.now();
            const elapsed = (now - lastFrameTime.current + 1000) / 1000; // fallback pra evitar /0

            const fps = Math.round(frameCount.current);
            const eventsPerSec = eventCount.current;
            const rendersPerSec = renderCount
                ? renderCount.current - lastRenderCount.current
                : 0;

            const heapMB = performance.memory
                ? Math.round(performance.memory.usedJSHeapSize / 1048576)
                : -1;

            setMetrics({ fps, eventsPerSec, rendersPerSec, heapMB });

            // Reset counters
            frameCount.current = 0;
            eventCount.current = 0;
            lastRenderCount.current = renderCount?.current ?? 0;
            lastFrameTime.current = now;
        }, 1000);

        return () => clearInterval(id);
    }, [visible, renderCount]);

    // Toggle Ctrl+P
    useEffect(() => {
        const onKey = (e) => {
            if (e.ctrlKey && e.key === 'p') {
                e.preventDefault();
                setVisible((v) => !v);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    if (!visible) return null;

    const fpsColor = metrics.fps >= 50 ? '#4ade80' : metrics.fps >= 30 ? '#facc15' : '#f87171';
    const evtColor = metrics.eventsPerSec <= 10 ? '#4ade80' : metrics.eventsPerSec <= 20 ? '#facc15' : '#f87171';
    const renderColor = metrics.rendersPerSec <= 5 ? '#4ade80' : metrics.rendersPerSec <= 15 ? '#facc15' : '#f87171';

    return (
        <div
            style={{
                position: 'fixed',
                top: 8,
                left: 8,
                zIndex: 99999,
                background: 'rgba(0,0,0,0.75)',
                backdropFilter: 'blur(4px)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6,
                padding: '6px 10px',
                fontFamily: 'monospace',
                fontSize: 11,
                lineHeight: 1.7,
                color: '#e2e8f0',
                pointerEvents: 'none',
                userSelect: 'none',
                minWidth: 160,
            }}
        >
            <div style={{ fontWeight: 700, fontSize: 10, opacity: 0.5, marginBottom: 2 }}>
                PERF MONITOR (Ctrl+P)
            </div>
            <Row label="FPS" value={metrics.fps} unit="fps" color={fpsColor} />
            <Row label="Socket events" value={metrics.eventsPerSec} unit="/s" color={evtColor} />
            <Row label="App renders" value={metrics.rendersPerSec} unit="/s" color={renderColor} />
            {metrics.heapMB >= 0 && (
                <Row label="JS Heap" value={metrics.heapMB} unit="MB" color="#94a3b8" />
            )}
        </div>
    );
}

function Row({ label, value, unit, color }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ opacity: 0.6 }}>{label}</span>
            <span style={{ color, fontWeight: 600 }}>
                {value}
                <span style={{ opacity: 0.5, fontWeight: 400 }}>{unit}</span>
            </span>
        </div>
    );
}
