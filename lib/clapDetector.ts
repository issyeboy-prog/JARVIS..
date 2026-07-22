"use client";

import { createMicAnalyser, getLevel } from "./audioEngine";

export interface ClapDetectorOptions {
  onDoubleClap: () => void;
  // Fired every frame with the current mic level (0..1) — lets the UI
  // show a live meter so the threshold below can actually be calibrated
  // against a real device/room instead of guessed blind.
  onLevel?: (level: number) => void;
}

// Listens to the mic for two sharp volume spikes within a short window —
// a "clap clap" pattern — and fires onDoubleClap(). Pure amplitude
// detection, no speech recognition, so it's cheap to leave running.
export function startClapDetector({
  onDoubleClap,
  onLevel,
}: ClapDetectorOptions): () => void {
  let stopped = false;
  let analyser: AnalyserNode | null = null;
  let raf = 0;

  const SPIKE_THRESHOLD = 0.16;
  const REFRACTORY_MS = 200; // ignore re-triggers from the same clap's decay
  const CLAP_WINDOW_MS = 1000; // max gap allowed between the two claps

  let lastSpikeAt = 0;
  let firstClapAt = 0;

  createMicAnalyser()
    .then((a) => {
      if (stopped) return;
      analyser = a;
      const buffer = new Uint8Array(new ArrayBuffer(a.fftSize));

      const tick = () => {
        if (stopped || !analyser) return;
        const level = getLevel(analyser, buffer);
        onLevel?.(level);
        const now = performance.now();

        if (level > SPIKE_THRESHOLD && now - lastSpikeAt > REFRACTORY_MS) {
          lastSpikeAt = now;
          if (now - firstClapAt <= CLAP_WINDOW_MS && firstClapAt !== 0) {
            firstClapAt = 0;
            onDoubleClap();
          } else {
            firstClapAt = now;
          }
        } else if (firstClapAt !== 0 && now - firstClapAt > CLAP_WINDOW_MS) {
          firstClapAt = 0; // window expired without a second clap
        }

        raf = requestAnimationFrame(tick);
      };
      tick();
    })
    .catch(() => {
      // Mic permission denied or unavailable — clap-to-wake just won't fire.
    });

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
