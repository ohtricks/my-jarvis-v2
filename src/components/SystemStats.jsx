import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

// ── Thresholds ────────────────────────────────────────────────────────────────
const CONTEXT_WINDOW   = 1_048_576; // Gemini 2.5 Flash – 1 M tokens
const SESSION_MAX_MIN  = 60;        // Reference session ceiling (minutes)
const CHARS_PER_TOKEN  = 4;         // Rough estimate: 1 token ≈ 4 chars
const MODEL_SHORT      = 'Gemini 2.5 Flash';
const MODEL_FULL       = 'gemini-2.5-flash-native-audio';

// ── Colour helpers ────────────────────────────────────────────────────────────
const barColor = (pct, warn = 70, danger = 88) =>
    pct >= danger ? '#ef4444' : pct >= warn ? '#f59e0b' : '#FF7518';

// ── Sub-components ────────────────────────────────────────────────────────────
const NeonBar = ({ pct = 0, warn, danger }) => {
    const clamped = Math.min(Math.max(pct, 0), 100);
    const color   = barColor(clamped, warn, danger);
    return (
        <div className="relative h-[3px] w-full bg-white/5 rounded-full overflow-hidden">
            <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ backgroundColor: color, boxShadow: `0 0 5px ${color}88` }}
                animate={{ width: `${clamped}%` }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
            />
        </div>
    );
};

const Row = ({ label, display, pct, warn, danger }) => (
    <div className="space-y-[3px]">
        <div className="flex justify-between items-baseline">
            <span className="text-[8.5px] tracking-[0.14em] uppercase text-orange-500/50">
                {label}
            </span>
            <span className="text-[10px] font-mono text-orange-200/80">
                {display ?? '—'}
            </span>
        </div>
        <NeonBar pct={pct ?? 0} warn={warn} danger={danger} />
    </div>
);

const CardHeader = ({ label }) => (
    <div className="flex items-center gap-1.5 pb-0.5">
        <motion.div
            className="w-[3px] h-3 rounded-full bg-orange-500"
            style={{ boxShadow: '0 0 6px #FF7518' }}
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="text-[8.5px] tracking-[0.22em] uppercase font-bold text-orange-400/60">
            {label}
        </span>
    </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
const SystemStats = ({ stats = {}, transcriptChars = 0, sessionStartMs = null }) => {
    const { cpu, ram, gpu, cpu_temp } = stats;

    // Model context usage estimate
    const estimatedTokens = Math.round(transcriptChars / CHARS_PER_TOKEN);
    const contextPct      = Math.min((estimatedTokens / CONTEXT_WINDOW) * 100, 100);

    // Session duration
    const sessionPct = useMemo(() => {
        if (!sessionStartMs) return 0;
        const elapsedMin = (Date.now() - sessionStartMs) / 60_000;
        return Math.min((elapsedMin / SESSION_MAX_MIN) * 100, 100);
    }, [sessionStartMs]);

    const hasGpu  = gpu      !== null && gpu      !== undefined;
    const hasTemp = cpu_temp !== null && cpu_temp !== undefined;

    return (
        <div className="flex flex-col gap-2 w-[160px] select-none">

            {/* ── Card 1: System ── */}
            <div className="bg-black/70 backdrop-blur-md border border-orange-500/[0.12] rounded-xl p-3 space-y-2">
                <CardHeader label="System" />

                <Row
                    label="CPU"
                    display={cpu != null ? `${cpu}%` : null}
                    pct={cpu}
                    warn={70} danger={88}
                />
                <Row
                    label="RAM"
                    display={ram != null ? `${ram}%` : null}
                    pct={ram}
                    warn={75} danger={90}
                />
                {hasGpu && (
                    <Row
                        label="GPU"
                        display={`${gpu}%`}
                        pct={gpu}
                        warn={70} danger={88}
                    />
                )}
                {hasTemp && (
                    <Row
                        label="CPU Temp"
                        display={`${cpu_temp}°C`}
                        pct={(cpu_temp / 100) * 100}
                        warn={70} danger={85}
                    />
                )}
            </div>

            {/* ── Card 2: Model ── */}
            <div className="bg-black/70 backdrop-blur-md border border-orange-500/[0.12] rounded-xl p-3 space-y-2">
                <CardHeader label="Model" />

                {/* Model name */}
                <div className="flex flex-col gap-[2px]">
                    <span className="text-[8.5px] tracking-[0.14em] uppercase text-orange-500/50">Engine</span>
                    <span
                        className="text-[9px] font-mono text-orange-300/60 truncate"
                        title={MODEL_FULL}
                    >
                        {MODEL_SHORT}
                    </span>
                </div>

                <Row
                    label="Context"
                    display={`${contextPct.toFixed(2)}%`}
                    pct={contextPct}
                    warn={60} danger={85}
                />
                <Row
                    label="Session"
                    display={sessionStartMs
                        ? `${Math.round((Date.now() - sessionStartMs) / 60_000)}m`
                        : '—'}
                    pct={sessionPct}
                    warn={70} danger={90}
                />
            </div>
        </div>
    );
};

export default SystemStats;
