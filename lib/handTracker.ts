"use client";

// Lightweight motion tracking: no ML model, just frame-differencing on a
// tiny downsampled canvas to find the centroid of whatever is moving in
// front of the camera (in practice, a hand held near the screen). This is
// not skeletal hand tracking — it's a cheap approximation good enough to
// make the sphere "follow" a waving hand.

export interface HandTrackerHandle {
  stop: () => void;
}

export interface HandTrackerCallbacks {
  // cx, cy: normalized 0..1 centroid of motion (mirrored to match what the
  // user sees of themselves). vx, vy: frame-to-frame velocity. magnitude:
  // total motion energy this frame, for gating out noise.
  onMotion: (cx: number, cy: number, vx: number, vy: number, magnitude: number) => void;
}

const SAMPLE_W = 48;
const SAMPLE_H = 36;
const DIFF_THRESHOLD = 60;
const MOTION_GATE = 4000;

export async function startHandTracker(
  videoEl: HTMLVideoElement,
  { onMotion }: HandTrackerCallbacks
): Promise<HandTrackerHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  const sample = document.createElement("canvas");
  sample.width = SAMPLE_W;
  sample.height = SAMPLE_H;
  const sctx = sample.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("2d-context-unavailable");

  let prevFrame: Uint8ClampedArray | null = null;
  let prevCx = 0.5;
  let prevCy = 0.5;
  let raf = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    if (videoEl.readyState >= 2) {
      sctx.save();
      sctx.translate(SAMPLE_W, 0);
      sctx.scale(-1, 1); // mirror, so it matches the user's own movement
      sctx.drawImage(videoEl, 0, 0, SAMPLE_W, SAMPLE_H);
      sctx.restore();
      const frame = sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

      if (prevFrame) {
        let sumX = 0;
        let sumY = 0;
        let sumW = 0;
        for (let y = 0; y < SAMPLE_H; y++) {
          for (let x = 0; x < SAMPLE_W; x++) {
            const i = (y * SAMPLE_W + x) * 4;
            const diff =
              Math.abs(frame[i] - prevFrame[i]) +
              Math.abs(frame[i + 1] - prevFrame[i + 1]) +
              Math.abs(frame[i + 2] - prevFrame[i + 2]);
            if (diff > DIFF_THRESHOLD) {
              sumX += x * diff;
              sumY += y * diff;
              sumW += diff;
            }
          }
        }
        if (sumW > MOTION_GATE) {
          const cx = sumX / sumW / SAMPLE_W;
          const cy = sumY / sumW / SAMPLE_H;
          onMotion(cx, cy, cx - prevCx, cy - prevCy, sumW);
          prevCx = cx;
          prevCy = cy;
        }
      }
      prevFrame = frame;
    }
    raf = requestAnimationFrame(tick);
  };
  tick();

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
