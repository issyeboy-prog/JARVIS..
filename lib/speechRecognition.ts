"use client";

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: Event) => void) | null;
}

function getRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

export function isSpeechRecognitionSupported(): boolean {
  return !!getRecognitionCtor();
}

// Listens for a single utterance and resolves with the final transcript.
// Used both for "hear the wake phrase" and "hear a command" after wake.
export function listenOnce(options?: {
  timeoutMs?: number;
}): Promise<string> {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return Promise.reject(new Error("speech-recognition-unsupported"));

  return new Promise((resolve, reject) => {
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    const timeout = setTimeout(() => {
      recognition.abort();
      reject(new Error("timeout"));
    }, options?.timeoutMs ?? 6000);

    recognition.onresult = (ev) => {
      clearTimeout(timeout);
      const transcript = Array.from(ev.results)
        .map((r) => r[0].transcript)
        .join(" ")
        .trim();
      resolve(transcript);
    };
    recognition.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("recognition-error"));
    };
    recognition.onend = () => clearTimeout(timeout);

    try {
      recognition.start();
    } catch (err) {
      // e.g. a still-active recognizer from a race with the background
      // listener — reject explicitly and clear the now-orphaned timer
      // rather than leaving it to fire (harmlessly, but untidily) later.
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error("recognition-start-failed"));
    }
  });
}

// Detects a wake-word at the start of an utterance and returns whatever
// was said after it — so "Jarvis, what's the weather" or "wake up daddy's
// home, what's the weather" both work as ONE spoken utterance instead of
// needing a separate listening round afterward. Returns:
//  - the trailing command text (possibly "") if a wake-word was found
//  - null if no wake-word was found at all
export function extractCommand(transcript: string): string | null {
  const t = transcript.trim();
  const lower = t.toLowerCase();

  const jarvisIdx = lower.indexOf("jarvis");
  if (jarvisIdx !== -1) {
    return t.slice(jarvisIdx + "jarvis".length).replace(/^[,.\s]+/, "");
  }

  const wakeMatch = lower.match(/wake\s*up.*?home/);
  if (wakeMatch && wakeMatch.index !== undefined) {
    return t.slice(wakeMatch.index + wakeMatch[0].length).replace(/^[,.\s]+/, "");
  }

  return null;
}

// Keeps a SpeechRecognition session running in the background so the wake
// phrase alone (no clap needed) can trigger wake-up. Browsers periodically
// end a "continuous" session on their own (mobile Chrome especially), so
// this auto-restarts until explicitly stopped. Note: this means audio
// streams continuously to the browser's speech-recognition service the
// entire time it's running, not just in short bursts.
export function startContinuousListening(
  onTranscript: (transcript: string) => void
): () => void {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return () => {};

  let stopped = false;
  let recognition: SpeechRecognitionLike | null = null;

  const start = () => {
    if (stopped) return;
    recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (result.isFinal) onTranscript(result[0].transcript);
      }
    };
    recognition.onend = () => {
      if (!stopped) start(); // browsers end continuous sessions periodically
    };
    recognition.onerror = () => {
      // 'no-speech' etc. — onend fires right after, which restarts it
    };

    try {
      recognition.start();
    } catch {
      // e.g. already running — the onend/restart loop will recover
    }
  };
  start();

  return () => {
    stopped = true;
    // abort() over stop(): stop() waits to flush a final result, which
    // extends how long this session holds onto the recognizer before a
    // fresh listenOnce() can safely start one — abort() releases it
    // immediately.
    recognition?.abort();
  };
}
