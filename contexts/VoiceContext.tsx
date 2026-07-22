"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createMicAnalyser, getLevel, resumeAudio } from "@/lib/audioEngine";
import { startClapDetector } from "@/lib/clapDetector";
import {
  extractCommand,
  isSpeechRecognitionSupported,
  listenOnce,
  startContinuousListening,
} from "@/lib/speechRecognition";
import { speak, type TtsEngineReport } from "@/lib/tts";
import { askAssistant } from "@/lib/assistant";
import { buildBriefingContext } from "@/lib/briefingContext";

export type VoiceStatus =
  | "inactive" // mic not yet granted, clap-to-wake off
  | "idle" // armed, waiting for clap/wake phrase/tap
  | "listening" // capturing a command
  | "thinking" // processing what was heard
  | "speaking"; // JARVIS talking

interface VoiceContextValue {
  status: VoiceStatus;
  micLevel: number; // 0..1, live mic amplitude (you talking)
  ttsLevel: number; // 0..1, live TTS playback amplitude (JARVIS talking)
  transcript: string;
  lastResponse: string;
  // Which TTS engine actually produced the last response, and why it fell
  // back if it did — otherwise this failure mode is a total black box.
  lastTtsEngine: TtsEngineReport | null;
  lastError: string | null;
  supported: boolean;
  activate: () => Promise<void>;
  talkNow: () => Promise<void>; // tap-to-talk shortcut, skips the wake phrase
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

// Speech-recognition support never changes at runtime, so there's nothing
// to subscribe to — this just satisfies useSyncExternalStore's contract.
function noopSubscribe() {
  return () => {};
}

// Gives an aborted recognizer a moment to fully release before a fresh one
// starts — starting a new SpeechRecognition instance while a previous one
// is still tearing down is a common source of silently-failing listens.
const RECOGNIZER_HANDOFF_MS = 200;

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<VoiceStatus>("inactive");
  const [micLevel, setMicLevel] = useState(0);
  const [ttsLevel, setTtsLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [lastResponse, setLastResponse] = useState("");
  const [lastTtsEngine, setLastTtsEngine] = useState<TtsEngineReport | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const stopClapDetectorRef = useRef<(() => void) | null>(null);
  const stopLevelLoopRef = useRef<(() => void) | null>(null);
  const stopWakeListenerRef = useRef<(() => void) | null>(null);
  // Feature detection differs between server (no `window`) and client, so
  // this needs the getServerSnapshot escape hatch rather than plain state
  // — it keeps the very first client render matching the server's.
  const supported = useSyncExternalStore(
    noopSubscribe,
    isSpeechRecognitionSupported,
    () => true
  );

  const runMicLevelLoop = useCallback(async () => {
    stopLevelLoopRef.current?.();
    let stopped = false;
    try {
      const analyser = await createMicAnalyser();
      const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      let raf = 0;
      const tick = () => {
        if (stopped) return;
        setMicLevel(getLevel(analyser, buffer));
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
    setMicLevel(0);
  }, []);

  // preHeard: command text already captured as part of the wake utterance
  // itself (e.g. "Jarvis, what's the weather"). When present, skips
  // straight to answering instead of opening a second listening round.
  const handleCommand = useCallback(async (preHeard?: string) => {
    // Stop the background clap/wake-word listeners synchronously, right
    // now — not by waiting for the status-change effect below to notice
    // and tear them down. That teardown is scheduled on React's next
    // render, which is not guaranteed to happen before the code below
    // tries to start a fresh SpeechRecognition instance. Two recognizers
    // racing is a likely cause of "listening" getting stuck: some browsers
    // don't fire onerror when start() collides with a still-active
    // session, they just silently do nothing.
    stopClapDetectorRef.current?.();
    stopClapDetectorRef.current = null;
    stopWakeListenerRef.current?.();
    stopWakeListenerRef.current = null;

    setStatus("listening");
    setLastError(null);
    try {
      // activate()/talkNow() resume the AudioContext, but that only covers
      // turns starting from a fresh tap. A clap or the background "Jarvis"
      // listener can trigger this with no click in the call stack at all —
      // if the context auto-suspended since the last turn (common on
      // mobile), TTS playback would silently produce no sound even though
      // audioEl.play() succeeds, since its output is routed through a
      // suspended Web Audio graph. Resuming here covers every path.
      await resumeAudio();

      let heard = preHeard?.trim();
      if (!heard) {
        // Give a just-aborted background recognizer a beat to release.
        await new Promise((r) => setTimeout(r, RECOGNIZER_HANDOFF_MS));
        await runMicLevelLoop();
        heard = await listenOnce({ timeoutMs: 6000 });
      }
      setTranscript(heard);
      stopMicLevelLoop();
      setStatus("thinking");

      // Live data (schedule, weather, news, date/time, quote/word) so
      // JARVIS can actually answer "give me a daily briefing" — or any
      // question touching this stuff — with real specifics instead of
      // guessing. Cheap fields resolve instantly; weather/news have a
      // short timeout and are just omitted if they don't come back in time.
      const context = await buildBriefingContext();
      const reply = await askAssistant(heard, context);
      setLastResponse(reply);
      setStatus("speaking");
      await new Promise<void>((resolve) => {
        speak(reply, {
          onLevel: setTtsLevel,
          onEnd: resolve,
          onEngine: setLastTtsEngine,
        });
      });
    } catch (err) {
      // Previously silent — status would just flicker back to idle with
      // zero visible feedback, indistinguishable from "nothing happened."
      // Surfacing it is what let "no audio" and "no subtitles" finally get
      // traced to the same root cause: recognition never completing.
      const message = err instanceof Error ? err.message : String(err);
      const friendly =
        message === "timeout"
          ? "Didn't catch anything — try again"
          : message === "recognition-error"
            ? "Speech recognition error — check mic permission"
            : message === "speech-recognition-unsupported"
              ? "Speech recognition isn't supported in this browser"
              : `Error: ${message}`;
      setLastError(friendly);
    } finally {
      stopMicLevelLoop();
      setTtsLevel(0);
      setStatus("idle");
    }
  }, [runMicLevelLoop, stopMicLevelLoop]);

  // Two independent ways to wake up: a double-clap (always opens a fresh
  // listen), or saying "Jarvis ..." / "wake up daddy's home ..." — the
  // wake-word and command can be one utterance, so the trailing text goes
  // straight to handleCommand instead of triggering a second listen.
  // Both only run while armed and idle, paused during listening/speaking
  // so JARVIS's own audio can't retrigger them.
  useEffect(() => {
    if (status !== "idle") {
      stopClapDetectorRef.current?.();
      stopClapDetectorRef.current = null;
      stopWakeListenerRef.current?.();
      stopWakeListenerRef.current = null;
      return;
    }

    stopClapDetectorRef.current = startClapDetector({
      onDoubleClap: () => handleCommand(),
      // Also drives the visible level meter/sphere while armed, so
      // there's live feedback for calibrating claps against a real room.
      onLevel: setMicLevel,
    });
    stopWakeListenerRef.current = startContinuousListening((heard) => {
      const command = extractCommand(heard);
      if (command !== null) handleCommand(command);
    });

    return () => {
      stopClapDetectorRef.current?.();
      stopClapDetectorRef.current = null;
      stopWakeListenerRef.current?.();
      stopWakeListenerRef.current = null;
    };
  }, [status, handleCommand]);

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
        micLevel,
        ttsLevel,
        transcript,
        lastResponse,
        lastTtsEngine,
        lastError,
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
