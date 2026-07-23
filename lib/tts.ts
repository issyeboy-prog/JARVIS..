"use client";

import { createElementAnalyser, getLevel } from "./audioEngine";

export interface SpeakHandle {
  stop: () => void;
}

export type TtsEngineReport =
  | { engine: "elevenlabs" }
  | { engine: "browser"; reason: string };

export interface SpeakOptions {
  // Called on every animation frame while JARVIS is speaking, 0..1.
  // Real spectrum data from ElevenLabs playback, or an approximated
  // pulse envelope when falling back to the browser's built-in voice.
  onLevel?: (level: number) => void;
  onEnd?: () => void;
  // Reports which engine actually ended up producing audio, and why it
  // fell back if it did — this was previously a black box even to the
  // user, making "I can't hear him" impossible to diagnose remotely.
  onEngine?: (report: TtsEngineReport) => void;
}

// Tries ElevenLabs (via our server route, so the API key stays server-side)
// and falls back to the browser's built-in speech synthesis if no key is
// configured yet, or the request fails for any reason.
export async function speak(
  text: string,
  opts: SpeakOptions = {}
): Promise<SpeakHandle> {
  const { onLevel, onEnd, onEngine } = opts;

  try {
    const handle = await speakWithElevenLabs(text, { onLevel, onEnd });
    onEngine?.({ engine: "elevenlabs" });
    return handle;
  } catch (err) {
    const fallbackReason = err instanceof Error ? err.message : String(err);
    onEngine?.({ engine: "browser", reason: fallbackReason });
    return speakWithBrowserVoice(text, { onLevel, onEnd });
  }
}

// Points the <audio> element straight at /api/tts and lets the browser
// stream + start playing as soon as enough of the response has buffered
// (the "canplay" event), instead of the previous fetch()-the-whole-blob-
// first approach — for anything longer than a short reply that was adding
// real, avoidable seconds before any sound came out.
function speakWithElevenLabs(
  text: string,
  { onLevel, onEnd }: Pick<SpeakOptions, "onLevel" | "onEnd">
): Promise<SpeakHandle> {
  return new Promise((resolve, reject) => {
    const audioEl = new Audio();
    // Defensive — rule out the audio element silently starting muted or
    // at zero volume for any reason.
    audioEl.muted = false;
    audioEl.volume = 1;

    let settled = false; // outer promise resolved/rejected yet?
    let stopped = false;
    let raf = 0;
    let analyser: AnalyserNode | null = null;
    let buffer: Uint8Array<ArrayBuffer> | null = null;

    const tick = () => {
      if (stopped || !analyser || !buffer) return;
      onLevel?.(getLevel(analyser, buffer));
      raf = requestAnimationFrame(tick);
    };

    // Shared by natural completion and manual stop() so onEnd always
    // fires exactly once either way — callers (like an interrupt
    // triggered mid-sentence by the wake word) await onEnd to know
    // playback has actually finished, not just that pause() was called.
    const finish = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      onLevel?.(0);
      onEnd?.();
    };

    const cleanupListeners = () => {
      audioEl.removeEventListener("canplay", onCanPlay);
      audioEl.removeEventListener("error", onError);
    };

    function onError() {
      if (settled) {
        // Already committed to this engine (playback had started) and it
        // failed mid-stream — nowhere left to fall back to, just stop.
        finish();
        return;
      }
      settled = true;
      cleanupListeners();
      reject(new Error("elevenlabs-playback-error"));
    }

    async function onCanPlay() {
      if (settled) return;
      settled = true;
      cleanupListeners();
      try {
        analyser = createElementAnalyser(audioEl);
        buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
        audioEl.addEventListener("ended", finish);
        await audioEl.play();
        tick();
        resolve({
          stop: () => {
            audioEl.pause();
            finish();
          },
        });
      } catch (err) {
        finish();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }

    audioEl.addEventListener("canplay", onCanPlay);
    audioEl.addEventListener("error", onError);
    audioEl.src = `/api/tts?text=${encodeURIComponent(text)}`;
    audioEl.load();
  });
}

function speakWithBrowserVoice(
  text: string,
  { onLevel, onEnd }: SpeakOptions
): SpeakHandle {
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.pitch = 0.85; // slightly deeper — closer to a JARVIS tone
  utterance.volume = 1;

  let stopped = false;
  let pulse = 0;
  let raf = 0;

  // speechSynthesis doesn't expose raw audio to Web Audio, so we
  // approximate reactivity with a decaying pulse on each word boundary.
  const decay = () => {
    if (stopped) return;
    pulse *= 0.85;
    onLevel?.(pulse);
    raf = requestAnimationFrame(decay);
  };
  decay();

  utterance.onboundary = () => {
    pulse = 1;
  };
  // Shared by natural completion, error, and manual stop() so onEnd fires
  // exactly once regardless of which path ends the utterance.
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    onLevel?.(0);
    onEnd?.();
  };
  utterance.onend = finish;
  utterance.onerror = finish;

  synth.speak(utterance);

  return {
    stop: () => {
      synth.cancel();
      finish();
    },
  };
}
