"use client";

import { createElementAnalyser, getLevel } from "./audioEngine";

export interface SpeakHandle {
  stop: () => void;
}

export interface SpeakOptions {
  // Called on every animation frame while JARVIS is speaking, 0..1.
  // Real spectrum data from ElevenLabs playback, or an approximated
  // pulse envelope when falling back to the browser's built-in voice.
  onLevel?: (level: number) => void;
  onEnd?: () => void;
}

// Tries ElevenLabs (via our server route, so the API key stays server-side)
// and falls back to the browser's built-in speech synthesis if no key is
// configured yet, or the request fails for any reason.
export async function speak(
  text: string,
  opts: SpeakOptions = {}
): Promise<SpeakHandle> {
  const { onLevel, onEnd } = opts;

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audioEl = new Audio(url);
      const analyser = createElementAnalyser(audioEl);
      const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      let raf = 0;
      let stopped = false;

      const tick = () => {
        if (stopped) return;
        onLevel?.(getLevel(analyser, buffer));
        raf = requestAnimationFrame(tick);
      };

      audioEl.addEventListener("ended", () => {
        stopped = true;
        cancelAnimationFrame(raf);
        URL.revokeObjectURL(url);
        onLevel?.(0);
        onEnd?.();
      });

      await audioEl.play();
      tick();

      return {
        stop: () => {
          stopped = true;
          cancelAnimationFrame(raf);
          audioEl.pause();
        },
      };
    }
  } catch {
    // Network error, etc. — fall through to the browser voice below.
  }

  return speakWithBrowserVoice(text, { onLevel, onEnd });
}

function speakWithBrowserVoice(
  text: string,
  { onLevel, onEnd }: SpeakOptions
): SpeakHandle {
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.pitch = 0.85; // slightly deeper — closer to a JARVIS tone

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
  utterance.onend = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    onLevel?.(0);
    onEnd?.();
  };
  utterance.onerror = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    onLevel?.(0);
    onEnd?.();
  };

  synth.speak(utterance);

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      synth.cancel();
    },
  };
}
