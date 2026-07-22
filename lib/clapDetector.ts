"use client";

import { createMicAnalyser, getLevel } from "./audioEngine";

// Listens to the mic for two sharp volume spikes within a short window —
// a "clap clap" pattern — and fires onDoubleClap(). Pure amplitude
// detection, no speech recognition, so it's cheap to leave running.
export function startClapDetector(onDoubleClap: () => void): () => void {
  let stopped = false;
  let analyser: AnalyserNode | null = null;
  let raf = 0;

  const SPIKE_THRESHOLD = 0.35;
  const REFRACTORY_MS = 250; // ignore re-triggers from the same clap's decay
  const CLAP_WINDOW_MS = 900; // max gap allowed between the two claps

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
