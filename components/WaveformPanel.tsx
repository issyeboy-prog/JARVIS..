"use client";

import { useEffect, useRef } from "react";
import { useVoice } from "@/contexts/VoiceContext";

const HISTORY_LENGTH = 80;

interface WaveformStripProps {
  level: number;
  color: string;
  label: string;
}

function WaveformStrip({ level, color, label }: WaveformStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  const historyRef = useRef<number[]>(new Array(HISTORY_LENGTH).fill(0));

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let frame = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      frame++;
      if (frame % 2 === 0) {
        const hist = historyRef.current;
        hist.push(levelRef.current);
        if (hist.length > HISTORY_LENGTH) hist.shift();
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const hist = historyRef.current;
      const step = w / (hist.length - 1);
      const mid = h / 2;
      const amp = h * 0.42;

      ctx.beginPath();
      hist.forEach((v, i) => {
        const x = i * step;
        const y = mid - v * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = hist.length - 1; i >= 0; i--) {
        ctx.lineTo(i * step, mid + hist[i] * amp);
      }
      ctx.closePath();
      ctx.fillStyle = `${color}22`;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [color]);

  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-[10px] uppercase tracking-widest text-cyan-200/50">
        {label}
      </span>
      <canvas ref={canvasRef} className="h-8 w-full flex-1" />
    </div>
  );
}

// The mic is physically "on" almost the entire time JARVIS is active — it
// has to be, to catch the wake word — but that's ambient monitoring, not
// JARVIS actually capturing what you say. Rendering that the same as a real
// capture (same bright color, same prominence) is exactly what made it look
// like "it's somehow always listening." Only the "listening" status is a
// real capture; everything else is dimmed and explicitly labeled standby.
const YOU_STATE: Record<string, { color: string; label: string; pulse: boolean }> = {
  inactive: { color: "#2b3a4a", label: "Off", pulse: false },
  idle: { color: "#2b7a8a", label: "Standby — wake word only", pulse: false },
  listening: { color: "#e838ff", label: "Capturing your command", pulse: true },
  thinking: { color: "#2b3a4a", label: "Off — processing", pulse: false },
  speaking: { color: "#2b7a8a", label: "Standby — wake word only", pulse: false },
};

const JARVIS_STATE: Record<string, { color: string; label: string }> = {
  inactive: { color: "#3a3a2b", label: "Off" },
  idle: { color: "#3a3a2b", label: "Silent" },
  listening: { color: "#3a3a2b", label: "Silent" },
  thinking: { color: "#3a3a2b", label: "Silent" },
  speaking: { color: "#22d3ee", label: "Talking" },
};

export default function WaveformPanel() {
  const { micLevel, ttsLevel, status } = useVoice();
  const you = YOU_STATE[status] ?? YOU_STATE.idle;
  const jarvis = JARVIS_STATE[status] ?? JARVIS_STATE.idle;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-[0.3em] text-cyan-400/70 holo-text">
        Voice Activity
      </h2>
      <div className="flex flex-col gap-1">
        <WaveformStrip level={micLevel} color={you.color} label="You" />
        <p className={`pl-[4.25rem] text-[10px] ${you.pulse ? "pulse-capturing text-fuchsia-300" : "text-cyan-200/35"}`}>
          {you.label}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <WaveformStrip level={ttsLevel} color={jarvis.color} label="Jarvis" />
        <p className="pl-[4.25rem] text-[10px] text-cyan-200/35">{jarvis.label}</p>
      </div>
    </div>
  );
}
