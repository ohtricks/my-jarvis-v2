import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const PRIMARY     = '#FF7518';
const PRIMARY_RGB = '255, 117, 24';
const CORE_RGB    = '255, 200, 140';

const RING_DEFS = [
    { count: 24, radiusMult: 1.15, speed:  0.28, size: 2.2, waveFreq: 5 },
    { count: 36, radiusMult: 1.50, speed: -0.18, size: 1.6, waveFreq: 7 },
    { count: 48, radiusMult: 1.88, speed:  0.12, size: 1.1, waveFreq: 9 },
];

const Visualizer = ({ socket, isListening = true, intensity = 0, width = 600, height = 400 }) => {
    const canvasRef   = useRef(null);
    const stateRef    = useRef({ isListening, intensity });
    const particleRef = useRef([]);

    useEffect(() => {
        stateRef.current.isListening = isListening;
    }, [isListening]);

    // Consume audio_data directly — bypasses App state entirely
    useEffect(() => {
        if (!socket) return;
        const handler = (data) => {
            const arr = data.data;
            const avg = arr.reduce((a, b) => a + b, 0) / arr.length / 255;
            stateRef.current.intensity = avg;
        };
        socket.on('audio_data', handler);
        return () => socket.off('audio_data', handler);
    }, [socket]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width  = width;
        canvas.height = height;

        const ctx   = canvas.getContext('2d');
        const cx    = width  / 2;
        const cy    = height / 2;
        const baseR = Math.min(width, height) * 0.22;

        // Build particle rings
        const particles = [];
        RING_DEFS.forEach(({ count, radiusMult, speed, size, waveFreq }) => {
            const r = baseR * radiusMult;
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2;
                particles.push({
                    baseRadius: r,
                    angle,
                    speed,
                    size,
                    waveFreq,
                    phase  : Math.random() * Math.PI * 2,
                    opacity: 0.55 + Math.random() * 0.45,
                });
            }
        });
        particleRef.current = particles;

        let animId;
        let t = 0;

        const draw = () => {
            t += 0.018;
            const { isListening: speaking, intensity: vol } = stateRef.current;

            ctx.clearRect(0, 0, width, height);

            const boost     = speaking ? vol * 0.45 + 0.12 : 0;
            const breathMul = Math.sin(t * 1.4) * 0.04 + 1;

            // ── Particles ──────────────────────────────────────────────────
            particles.forEach(p => {
                p.angle += p.speed * 0.012;

                const waveAmp = speaking
                    ? 20 + vol * 30
                    : 4 + Math.sin(t * 0.7 + p.phase) * 3;

                const wave = Math.sin(p.angle * p.waveFreq + t * 2.2 + p.phase) * waveAmp;
                const r    = (p.baseRadius + wave) * breathMul;
                const x    = cx + Math.cos(p.angle) * r;
                const y    = cy + Math.sin(p.angle) * r;

                const flicker = speaking
                    ? 0.6 + Math.abs(Math.sin(p.angle * 4 + t * 4)) * 0.4
                    : 0.45;

                const pSize = p.size + (speaking ? boost * 2.5 : 0);

                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, pSize, 0, Math.PI * 2);
                ctx.fillStyle   = `rgba(${PRIMARY_RGB}, ${p.opacity * flicker})`;
                ctx.shadowBlur  = speaking ? 14 : 7;
                ctx.shadowColor = PRIMARY;
                ctx.fill();
                ctx.restore();
            });

            // ── Orb ────────────────────────────────────────────────────────
            const orbR = baseR * (speaking ? 0.84 + boost * 0.28 : 0.82 * breathMul);

            // Diffuse outer aura
            const aura = ctx.createRadialGradient(cx, cy, orbR * 0.4, cx, cy, orbR * 2.2);
            aura.addColorStop(0, `rgba(${PRIMARY_RGB}, ${speaking ? 0.22 + boost * 0.18 : 0.10})`);
            aura.addColorStop(1, `rgba(${PRIMARY_RGB}, 0)`);
            ctx.beginPath();
            ctx.arc(cx, cy, orbR * 2.2, 0, Math.PI * 2);
            ctx.fillStyle = aura;
            ctx.fill();

            // Neon rim
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${PRIMARY_RGB}, ${speaking ? 0.95 : 0.50})`;
            ctx.lineWidth   = speaking ? 2.5 : 1.5;
            ctx.shadowBlur  = speaking ? 35 : 18;
            ctx.shadowColor = PRIMARY;
            ctx.stroke();
            ctx.restore();

            // Inner core fill
            const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR * 0.9);
            core.addColorStop(0,    `rgba(${CORE_RGB}, ${speaking ? 0.38 : 0.15})`);
            core.addColorStop(0.55, `rgba(${PRIMARY_RGB}, ${speaking ? 0.18 : 0.07})`);
            core.addColorStop(1,    `rgba(${PRIMARY_RGB}, 0)`);
            ctx.beginPath();
            ctx.arc(cx, cy, orbR * 0.9, 0, Math.PI * 2);
            ctx.fillStyle = core;
            ctx.fill();

            // Outer pulse ring when speaking
            if (speaking) {
                const pulseR = orbR + 14 + Math.sin(t * 5) * 9;
                const pulseA = 0.28 + Math.sin(t * 5) * 0.14;
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(${PRIMARY_RGB}, ${pulseA})`;
                ctx.lineWidth   = 1;
                ctx.shadowBlur  = 18;
                ctx.shadowColor = PRIMARY;
                ctx.stroke();
                ctx.restore();
            }

            animId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(animId);
    }, [width, height]);

    const fontSize = Math.min(width, height) * 0.09;
    const glowText = isListening
        ? `0 0 18px ${PRIMARY}, 0 0 40px ${PRIMARY}, 0 0 80px rgba(${PRIMARY_RGB},0.45)`
        : `0 0 10px rgba(${PRIMARY_RGB},0.55)`;

    return (
        <div className="relative" style={{ width, height }}>
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <motion.div
                    animate={{ scale: isListening ? [1, 1.07, 1] : 1 }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                    style={{
                        fontSize,
                        fontWeight   : 'bold',
                        letterSpacing: '0.22em',
                        color        : '#FFAA60',
                        textShadow   : glowText,
                        fontFamily   : 'inherit',
                    }}
                >
                    J.A.R.V.I.S
                </motion.div>
            </div>

            <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
        </div>
    );
};

export default Visualizer;
