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

export interface HandPoint {
  x: number;
  y: number;
}

export interface HandGestureCallbacks {
  // Keyed by MediaPipe's handedness label so a hand keeps its identity
  // across frames (and across hands entering/leaving frame) rather than
  // jumping around by array index. Positions are smoothed (EMA) here, not
  // raw per-frame landmarks, to cut down on jitter.
  onHands: (hands: { left: HandPoint | null; right: HandPoint | null }) => void;
  onFist: () => void; // fires once per fresh Closed_Fist detection, either hand
  // Fires once per fresh Victory (peace sign — index + middle extended)
  // detection, either hand. "Victory" is MediaPipe's built-in category
  // name for this gesture — no custom landmark geometry needed.
  onPeaceSign?: () => void;
}

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task";

const SMOOTHING = 0.55; // higher = snappier/less smooth, lower = smoother/more lag

let recognizerPromise: Promise<GestureRecognizer> | null = null;

function getRecognizer(): Promise<GestureRecognizer> {
  if (!recognizerPromise) {
    recognizerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      return GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
    })();
  }
  return recognizerPromise;
}

function smooth(prev: HandPoint | null, next: HandPoint): HandPoint {
  if (!prev) return next;
  return {
    x: prev.x + (next.x - prev.x) * SMOOTHING,
    y: prev.y + (next.y - prev.y) * SMOOTHING,
  };
}

export async function startHandGestures(
  videoEl: HTMLVideoElement,
  { onHands, onFist, onPeaceSign }: HandGestureCallbacks
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
  let wasPeaceSign = false;
  let smoothedLeft: HandPoint | null = null;
  let smoothedRight: HandPoint | null = null;

  const tick = () => {
    if (stopped) return;
    if (videoEl.readyState >= 2) {
      const result = recognizer.recognizeForVideo(videoEl, performance.now());

      let rawLeft: HandPoint | null = null;
      let rawRight: HandPoint | null = null;
      result.handedness.forEach((categories, i) => {
        const label = categories[0]?.categoryName;
        const wrist = result.landmarks[i]?.[0];
        if (!wrist) return;
        const point: HandPoint = { x: 1 - wrist.x, y: wrist.y }; // mirror for front camera
        if (label === "Left") rawLeft = point;
        else if (label === "Right") rawRight = point;
      });

      smoothedLeft = rawLeft ? smooth(smoothedLeft, rawLeft) : null;
      smoothedRight = rawRight ? smooth(smoothedRight, rawRight) : null;
      onHands({ left: smoothedLeft, right: smoothedRight });

      const isFist = result.gestures.some(
        (g) => g[0]?.categoryName === "Closed_Fist" && g[0].score > 0.6
      );
      if (isFist && !wasFist) onFist();
      wasFist = isFist;

      const isPeaceSign = result.gestures.some(
        (g) => g[0]?.categoryName === "Victory" && g[0].score > 0.6
      );
      if (isPeaceSign && !wasPeaceSign) onPeaceSign?.();
      wasPeaceSign = isPeaceSign;
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
