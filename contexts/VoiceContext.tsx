"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createMicAnalyser, getLevel, resumeAudio } from "@/lib/audioEngine";
import { startClapDetector } from "@/lib/clapDetector";
import {
  isSpeechRecognitionSupported,
  listenOnce,
  matchesWakePhrase,
} from "@/lib/speechRecognition";
import { speak } from "@/lib/tts";

export type VoiceStatus =
  | "inactive" // mic not yet granted, clap-to-wake off
  | "idle" // armed, waiting for clap/wake phrase/tap
  | "listening" // capturing a command
  | "thinking" // processing what was heard
  | "speaking"; // JARVIS talking

interface VoiceContextValue {
  status: VoiceStatus;
  level: number; // 0..1 reactive amplitude driving the nebula
  transcript: string;
  lastResponse: string;
  supported: boolean;
  activate: () => Promise<void>;
  talkNow: () => Promise<void>; // tap-to-talk shortcut, skips the wake phrase
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

// Stand-in for a real command backend. Swap this out once JARVIS is wired
// to an actual assistant/LLM.
function respondTo(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("time")) {
    return `It's ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  }
  if (t.includes("hello") || t.includes("hi ")) {
    return "Hello. I'm listening.";
  }
  return `I heard: ${text}`;
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<VoiceStatus>("inactive");
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [lastResponse, setLastResponse] = useState("");

  const stopClapDetectorRef = useRef<(() => void) | null>(null);
  const stopLevelLoopRef = useRef<(() => void) | null>(null);
  // Optimistic default so server and first client render match; corrected
  // right after mount, when `window` is actually available to check.
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(isSpeechRecognitionSupported());
  }, []);

  const runMicLevelLoop = useCallback(async () => {
    stopLevelLoopRef.current?.();
    let stopped = false;
    try {
      const analyser = await createMicAnalyser();
      const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      let raf = 0;
      const tick = () => {
        if (stopped) return;
        setLevel(getLevel(analyser, buffer));
        raf = requestAnimationFrame(tick);
      };
      tick();
      stopLevelLoopRef.current = () => {
        stopped = true;
        cancelAnimationFrame(raf);
      };
    } catch {
      // mic unavailable — level just stays flat
    }
  }, []);

  const stopMicLevelLoop = useCallback(() => {
    stopLevelLoopRef.current?.();
    stopLevelLoopRef.current = null;
    setLevel(0);
  }, []);

  const handleCommand = useCallback(async () => {
    setStatus("listening");
    await runMicLevelLoop();
    try {
      const heard = await listenOnce({ timeoutMs: 6000 });
      setTranscript(heard);
      stopMicLevelLoop();
      setStatus("thinking");

      const reply = respondTo(heard);
      setLastResponse(reply);
      setStatus("speaking");
      await new Promise<void>((resolve) => {
        speak(reply, {
          onLevel: setLevel,
          onEnd: resolve,
        });
      });
    } catch {
      // timed out or no speech — just go back to idle
    } finally {
      stopMicLevelLoop();
      setStatus("idle");
    }
  }, [runMicLevelLoop, stopMicLevelLoop]);

  const handleWake = useCallback(async () => {
    setStatus("listening");
    await runMicLevelLoop();
    try {
      const heard = await listenOnce({ timeoutMs: 4000 });
      stopMicLevelLoop();
      if (matchesWakePhrase(heard)) {
        await handleCommand();
        return;
      }
    } catch {
      // no phrase heard in time
    }
    stopMicLevelLoop();
    setStatus("idle");
  }, [runMicLevelLoop, stopMicLevelLoop, handleCommand]);

  // Clap-to-wake only runs while armed and idle — paused during
  // listening/speaking so JARVIS's own audio can't retrigger it.
  useEffect(() => {
    if (status === "idle") {
      stopClapDetectorRef.current = startClapDetector(() => {
        handleWake();
      });
    } else {
      stopClapDetectorRef.current?.();
      stopClapDetectorRef.current = null;
    }
    return () => {
      stopClapDetectorRef.current?.();
      stopClapDetectorRef.current = null;
    };
  }, [status, handleWake]);

  const activate = useCallback(async () => {
    if (status !== "inactive") return;
    await resumeAudio();
    await createMicAnalyser(); // triggers the mic permission prompt up front
    setStatus("idle");
  }, [status]);

  const talkNow = useCallback(async () => {
    await resumeAudio();
    if (status === "inactive") {
      await createMicAnalyser();
    }
    if (status === "listening" || status === "thinking") return;
    await handleCommand();
  }, [status, handleCommand]);

  return (
    <VoiceContext.Provider
      value={{
        status,
        level,
        transcript,
        lastResponse,
        supported,
        activate,
        talkNow,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice must be used within a VoiceProvider");
  return ctx;
}
