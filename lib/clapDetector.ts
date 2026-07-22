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
//
// The trigger threshold is adaptive rather than a fixed magic number: a
// fixed threshold guessed blind (with no way to test against a real mic/
// room from a dev sandbox) turned out to be unreliable across devices.
// Instead this tracks a rolling estimate of the ambient noise floor and
// fires on anything that spikes well above it — self-calibrating to
// whatever room/mic it's actually running on.
export function startClapDetector({
  onDoubleClap,
  onLevel,
}: ClapDetectorOptions): () => void {
  let stopped = false;
  let analyser: AnalyserNode | null = null;
  let raf = 0;

  const SPIKE_MULTIPLIER = 2.2; // spike must be this many times the floor
  const MIN_ABSOLUTE_THRESHOLD = 0.05; // floor for near-silent rooms
  const FLOOR_ADAPT_RATE = 0.02; // how fast the ambient estimate drifts
  const REFRACTORY_MS = 200; // ignore re-triggers from the same clap's decay
  const CLAP_WINDOW_MS = 1000; // max gap allowed between the two claps

  let noiseFloor = 0.02;
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

        const threshold = Math.max(
          noiseFloor * SPIKE_MULTIPLIER,
          MIN_ABSOLUTE_THRESHOLD
        );

        if (level > threshold && now - lastSpikeAt > REFRACTORY_MS) {
          lastSpikeAt = now;
          if (now - firstClapAt <= CLAP_WINDOW_MS && firstClapAt !== 0) {
            firstClapAt = 0;
            onDoubleClap();
          } else {
            firstClapAt = now;
          }
        } else if (firstClapAt !== 0 && now - firstClapAt > CLAP_WINDOW_MS) {
          firstClapAt = 0; // window expired without a second clap
        } else if (level < threshold) {
          // Only drift the floor toward quiet/ambient readings, never
          // toward the spike itself, so a clap can't raise its own bar.
          noiseFloor += (level - noiseFloor) * FLOOR_ADAPT_RATE;
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
