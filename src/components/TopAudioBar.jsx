import React, { useEffect, useRef } from 'react';

// Accepts audioDataRef (a React ref containing a Uint8Array / number[]).
// Runs its own continuous RAF loop — no re-render of App on every mic frame.
const TopAudioBar = ({ audioDataRef }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        let animId;
        const draw = () => {
            const width = canvas.width;
            const height = canvas.height;
            ctx.clearRect(0, 0, width, height);

            const audioData = audioDataRef?.current;
            if (audioData && audioData.length > 0) {
                const barWidth = 4;
                const gap = 2;
                const totalBars = Math.floor(width / (barWidth + gap));
                const center = width / 2;

                for (let i = 0; i < totalBars / 2; i++) {
                    const value = audioData[i % audioData.length] || 0;
                    const percent = value / 255;
                    const barHeight = Math.max(2, percent * height);

                    ctx.fillStyle = `rgba(255, 117, 24, ${0.2 + percent * 0.8})`;

                    // Right side
                    ctx.fillRect(center + i * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
                    // Left side
                    ctx.fillRect(center - (i + 1) * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
                }
            }

            animId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(animId);
    }, [audioDataRef]);

    return (
        <canvas
            ref={canvasRef}
            width={300}
            height={40}
            className="opacity-80"
        />
    );
};

export default TopAudioBar;
