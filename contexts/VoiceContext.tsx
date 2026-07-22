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
import { speak, type SpeakHandle, type TtsEngineReport } from "@/lib/tts";
import { askAssistant } from "@/lib/assistant";
import { buildBriefingContext } from "@/lib/briefingContext";
import { resetAllPanels } from "@/lib/panelReset";

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

// A whole utterance matching one of these (nothing else said) cuts JARVIS
// off mid-sentence instead of being treated as a question for the
// assistant. Anchored so it only fires on a clean "stop", not a sentence
// that happens to contain the word (e.g. "don't stop the music").
const STOP_PHRASE_RE =
  /^(stop( talking)?|(be )?quiet|silence|that'?s (enough|all)|never ?mind|cancel|shut up)[.!]?$/i;

// Handled locally instead of round-tripping to the assistant — it's a
// direct action on the panels, not a question, and this way it still
// works even before an ANTHROPIC_API_KEY is configured.
const RESET_DISPLAY_RE = /\breset (?:the )?(?:display|panels?|layout|boxes|screen)\b/i;

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
  // The in-flight TTS playback handle, so a "Jarvis, stop" heard mid-
  // sentence can cut it off — only set while status is "speaking".
  const speakHandleRef = useRef<SpeakHandle | null>(null);
  // Set right before an interrupt cancels playback, so handleCommand's own
  // finally block (still suspended on the now-resolving speak promise)
  // knows not to stomp the status a second handleCommand call is already
  // setting — see cancelSpeaking/handleWakeDuringSpeech below.
  const interruptingRef = useRef(false);
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

  // Speaks a reply and captures the handle so a later "Jarvis"/"stop" can
  // interrupt it. Shared by the real assistant path and any locally
  // handled command (e.g. "reset display") that skips the network call.
  const speakReply = useCallback((reply: string) => {
    setLastResponse(reply);
    setStatus("speaking");
    return new Promise<void>((resolve) => {
      let ended = false;
      speak(reply, {
        onLevel: setTtsLevel,
        onEnd: () => {
          ended = true;
          speakHandleRef.current = null;
          resolve();
        },
        onEngine: setLastTtsEngine,
      }).then((handle) => {
        // onEnd can fire before this resolves (very short replies) —
        // don't resurrect a handle for playback that's already done.
        if (!ended) speakHandleRef.current = handle;
      });
    });
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

      if (RESET_DISPLAY_RE.test(heard)) {
        // A direct action on the panels, not a question — handled locally
        // so it works instantly and even without an assistant configured.
        resetAllPanels();
        await speakReply("Display reset.");
      } else {
        // Live data (schedule, weather, news, date/time, quote/word) so
        // JARVIS can actually answer "give me a daily briefing" — or any
        // question touching this stuff — with real specifics instead of
        // guessing. Cheap fields resolve instantly; weather/news have a
        // short timeout and are just omitted if they don't come back in
        // time.
        const context = await buildBriefingContext();
        const reply = await askAssistant(heard, context);
        await speakReply(reply);
      }
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
      // If this call's speech was cut off by an interrupt, whoever
      // triggered it already owns the status transition (either straight
      // to idle, or into a fresh handleCommand of its own) — setting idle
      // here too would race it and can clobber "listening" right back to
      // "idle" a beat later.
      if (interruptingRef.current) {
        interruptingRef.current = false;
      } else {
        setStatus("idle");
      }
    }
  }, [runMicLevelLoop, stopMicLevelLoop, speakReply]);

  // Cuts off whatever JARVIS is currently saying. Safe to call when
  // nothing is playing (no-op).
  const cancelSpeaking = useCallback(() => {
    if (!speakHandleRef.current) return;
    interruptingRef.current = true;
    speakHandleRef.current.stop();
    speakHandleRef.current = null;
    setTtsLevel(0);
  }, []);

  // Called when the wake word is heard while JARVIS is mid-sentence.
  // Saying "Jarvis" always takes priority over whatever he's doing —
  // cuts him off, then either runs the new command straight away (if one
  // was said in the same breath), opens a fresh listen (bare "Jarvis"),
  // or — for an explicit stop phrase — just goes quiet.
  const handleWakeDuringSpeech = useCallback(
    (command: string) => {
      const cmd = command.trim();
      cancelSpeaking();
      if (cmd && STOP_PHRASE_RE.test(cmd)) {
        setStatus("idle");
      } else {
        handleCommand(cmd);
      }
    },
    [cancelSpeaking, handleCommand]
  );

  // Two independent ways to wake up: a double-clap (always opens a fresh
  // listen), or saying "Jarvis ..." / "wake up daddy's home ..." — the
  // wake-word and command can be one utterance, so the trailing text goes
  // straight to handleCommand instead of triggering a second listen.
  // The clap detector only runs while idle (JARVIS's own audio would
  // otherwise "clap" it via speaker bleed). The wake-word listener,
  // though, also stays armed while *speaking* — that's what lets "Jarvis"
  // (or a bare "stop") interrupt him mid-sentence instead of only working
  // once he's done talking. Both are fully paused during listening/
  // thinking, since a second recognizer racing the active one is exactly
  // what used to cause "stuck on listening".
  useEffect(() => {
    const armed = status === "idle" || status === "speaking";
    if (!armed) {
      stopClapDetectorRef.current?.();
      stopClapDetectorRef.current = null;
      stopWakeListenerRef.current?.();
      stopWakeListenerRef.current = null;
      return;
    }

    if (status === "idle") {
      stopClapDetectorRef.current = startClapDetector({
        onDoubleClap: () => handleCommand(),
        // Also drives the visible level meter/sphere while armed, so
        // there's live feedback for calibrating claps against a real room.
        onLevel: setMicLevel,
      });
    }

    stopWakeListenerRef.current = startContinuousListening((heard) => {
      if (status === "speaking") {
        // A bare "stop" (no wake word) only makes sense as an interrupt
        // while he's actually talking — checked here rather than folded
        // into extractCommand, which only recognizes wake-word utterances.
        if (STOP_PHRASE_RE.test(heard.trim())) {
          cancelSpeaking();
          setStatus("idle");
          return;
        }
        const command = extractCommand(heard);
        if (command !== null) handleWakeDuringSpeech(command);
        return;
      }
      const command = extractCommand(heard);
      if (command !== null) handleCommand(command);
    });

    return () => {
      stopClapDetectorRef.current?.();
      stopClapDetectorRef.current = null;
      stopWakeListenerRef.current?.();
      stopWakeListenerRef.current = null;
    };
  }, [status, handleCommand, handleWakeDuringSpeech, cancelSpeaking]);

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
