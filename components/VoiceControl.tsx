"use client";

import { useVoice } from "@/contexts/VoiceContext";

const STATUS_LABEL: Record<string, string> = {
  inactive: "Tap to activate",
  idle: "Armed — clap twice or tap to talk",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export default function VoiceControl() {
  const { status, level, transcript, lastResponse, supported, activate, talkNow } =
    useVoice();

  if (!supported) {
    return (
      <p className="text-sm text-amber-300/80">
        This browser doesn&apos;t support voice recognition. Try Chrome.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <button
        onClick={() => (status === "inactive" ? activate() : talkNow())}
        disabled={status === "listening" || status === "thinking"}
        className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-6 py-2 text-sm uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-500/20 disabled:opacity-50"
      >
        {STATUS_LABEL[status]}
      </button>
      {status === "idle" && (
        <div className="flex w-48 items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-cyan-200/40">
            Mic
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-cyan-500/10">
            <div
              className="h-full bg-cyan-400 transition-[width] duration-75"
              style={{ width: `${Math.min(level * 100 * 2.5, 100)}%` }}
            />
          </div>
        </div>
      )}
      {transcript && (
        <p className="text-xs text-cyan-200/50">&ldquo;{transcript}&rdquo;</p>
      )}
      {lastResponse && (
        <p className="text-sm text-cyan-50/80">{lastResponse}</p>
      )}
    </div>
  );
}
