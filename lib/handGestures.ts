"use client";

import {
  FilesetResolver,
  GestureRecognizer,
} from "@mediapipe/tasks-vision";

// Real hand-landmark tracking (MediaPipe) instead of naive motion-diffing —
// gives a stable per-frame palm position (for precise drag-follow) and
// actual gesture classification (for detecting a closed fist to trigger
// the bounce effect). The wasm runtime and model are fetched lazily from
// Google's CDN the first time this is called, only after the user opts in
// via the hand-tracking toggle.

export interface HandGestureHandle {
  stop: () => void;
}

export interface HandGestureCallbacks {
  // cx, cy: normalized 0..1 palm position, mirrored to match what the
  // user sees of themselves.
  onPosition: (cx: number, cy: number) => void;
  onFist: () => void; // fires once per fresh Closed_Fist detection
}

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task";

let recognizerPromise: Promise<GestureRecognizer> | null = null;

function getRecognizer(): Promise<GestureRecognizer> {
  if (!recognizerPromise) {
    recognizerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      return GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });
    })();
  }
  return recognizerPromise;
}

export async function startHandGestures(
  videoEl: HTMLVideoElement,
  { onPosition, onFist }: HandGestureCallbacks
): Promise<HandGestureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  const recognizer = await getRecognizer();
  let stopped = false;
  let raf = 0;
  let wasFist = false;

  const tick = () => {
    if (stopped) return;
    if (videoEl.readyState >= 2) {
      const result = recognizer.recognizeForVideo(videoEl, performance.now());

      if (result.landmarks.length > 0) {
        // Landmark 0 is the wrist — stable enough as a palm-position proxy.
        const wrist = result.landmarks[0][0];
        onPosition(1 - wrist.x, wrist.y); // mirror x for the front camera
      }

      const top = result.gestures[0]?.[0];
      const isFist = !!top && top.categoryName === "Closed_Fist" && top.score > 0.6;
      if (isFist && !wasFist) onFist();
      wasFist = isFist;
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
