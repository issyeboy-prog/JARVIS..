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

    recognition.start();
  });
}

// Loose match so minor mis-transcriptions ("wake up dad's home") still count.
export function matchesWakePhrase(transcript: string): boolean {
  const t = transcript.toLowerCase().replace(/[^a-z\s]/g, "");
  const required = ["wake", "home"];
  return required.every((word) => t.includes(word));
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
    recognition?.stop();
  };
}
