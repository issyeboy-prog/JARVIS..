"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { isSpeechRecognitionSupported, listenOnce } from "@/lib/speechRecognition";

function subscribe() {
  return () => {};
}

type Phase = "idle" | "listening" | "verifying" | "denied";

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  // Deliberately not persisted anywhere (no localStorage, no long-lived
  // cookie) — same "every reopen starts fresh" behavior as the display
  // reset: this state lives only for as long as this component instance
  // does, so a full page reload always re-mounts locked.
  const [unlocked, setUnlocked] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [typedPhrase, setTypedPhrase] = useState("");
  const supported = useSyncExternalStore(subscribe, isSpeechRecognitionSupported, () => true);

  const submitPhrase = useCallback(async (phrase: string) => {
    setPhase("verifying");
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase }),
      });
      if (!res.ok) {
        setPhase("denied");
        return;
      }
      setUnlocked(true);
    } catch {
      setPhase("denied");
    }
  }, []);

  const startListening = useCallback(async () => {
    setPhase("listening");
    try {
      const heard = await listenOnce({ timeoutMs: 6000 });
      await submitPhrase(heard);
    } catch {
      setPhase("denied");
    }
  }, [submitPhrase]);

  if (unlocked) return <>{children}</>;

  const statusText =
    phase === "listening"
      ? "Listening..."
      : phase === "verifying"
        ? "Verifying..."
        : phase === "denied"
          ? "Access denied — try again"
          : "Say the passphrase, or type it below";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070c] p-4">
      <div
        className="glass-panel holo-panel w-full max-w-sm text-center"
        style={{ "--holo-delay": "0s" } as React.CSSProperties}
      >
        <div className="mb-1 text-[11px] uppercase tracking-[0.4em] text-cyan-400/60">
          Jarvis
        </div>
        <h1 className="holo-text mb-4 text-lg font-semibold uppercase tracking-[0.2em] text-cyan-200">
          Access Restricted
        </h1>

        <p
          className={`mb-5 min-h-[1.25rem] text-sm ${
            phase === "denied" ? "text-amber-300" : "text-cyan-300/70"
          }`}
        >
          {statusText}
        </p>

        {supported && (
          <button
            type="button"
            onClick={startListening}
            disabled={phase === "listening" || phase === "verifying"}
            className="mb-4 w-full rounded-lg border border-cyan-400/40 bg-cyan-400/10 py-2.5 text-sm uppercase tracking-[0.15em] text-cyan-200 transition hover:bg-cyan-400/20 disabled:opacity-50"
          >
            {phase === "listening" ? "Listening..." : "Speak Passphrase"}
          </button>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (typedPhrase.trim()) submitPhrase(typedPhrase);
          }}
          className="flex gap-2"
        >
          <input
            type="password"
            value={typedPhrase}
            onChange={(e) => setTypedPhrase(e.target.value)}
            placeholder="or type it here"
            className="min-w-0 flex-1 rounded-lg border border-cyan-400/25 bg-black/30 px-3 py-2 text-sm text-cyan-100 placeholder:text-cyan-400/30 focus:border-cyan-400/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={phase === "verifying" || !typedPhrase.trim()}
            className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-4 text-sm uppercase tracking-[0.15em] text-cyan-200 transition hover:bg-cyan-400/20 disabled:opacity-50"
          >
            Go
          </button>
        </form>
      </div>
    </div>
  );
}
