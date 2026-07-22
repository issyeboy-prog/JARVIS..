"use client";

import { useVoice } from "@/contexts/VoiceContext";

const DOT_COLOR: Record<string, string> = {
  inactive: "bg-slate-500",
  idle: "bg-cyan-400",
  listening: "bg-teal-400",
  thinking: "bg-violet-400",
  speaking: "bg-cyan-300",
};

export default function SystemStatusPanel() {
  const { status, supported, lastTtsEngine } = useVoice();

  const rows = [
    { label: "Voice engine", value: supported ? "Online" : "Unsupported" },
    { label: "Status", value: status },
    { label: "Mic", value: status === "inactive" ? "Standby" : "Armed" },
  ];

  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="text-xs uppercase tracking-[0.3em] text-cyan-400/70 holo-text">
        System
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-cyan-200/60">{r.label}</span>
            <span className="flex items-center gap-2 text-cyan-50/90">
              <span
                className={`h-1.5 w-1.5 rounded-full ${DOT_COLOR[status] ?? "bg-slate-500"}`}
              />
              {r.value}
            </span>
          </li>
        ))}
      </ul>
      {lastTtsEngine && (
        <div className="mt-1 border-t border-cyan-500/10 pt-2 text-xs">
          <div className="flex items-center justify-between text-cyan-200/60">
            <span>Last voice</span>
            <span className={lastTtsEngine.engine === "elevenlabs" ? "text-emerald-300" : "text-amber-300"}>
              {lastTtsEngine.engine === "elevenlabs" ? "ElevenLabs" : "Browser (fallback)"}
            </span>
          </div>
          {lastTtsEngine.engine === "browser" && (
            <p className="mt-1 text-cyan-200/40">Reason: {lastTtsEngine.reason}</p>
          )}
        </div>
      )}
    </div>
  );
}
