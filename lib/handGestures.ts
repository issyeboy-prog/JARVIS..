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
  // "Coyote" hand shadow-puppet shape: thumb pinched to both the middle and
  // ring fingertips, index and pinky left extended as the "ears." Not one
  // of MediaPipe's built-in gesture categories, so this is detected from
  // raw landmark geometry instead (see isCoyoteShape below).
  onCoyoteSign?: () => void;
  // Index + middle fingers extended together (not splayed like a peace
  // sign), ring/pinky curled, swept sideways. Fires once per completed
  // swipe while the shape is held.
  onSwipe?: (direction: "left" | "right") => void;
}

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task";

const SMOOTHING = 0.7; // higher = snappier/less smooth, lower = smoother/more lag

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

interface Landmark3 {
  x: number;
  y: number;
  z: number;
}

function dist3(a: Landmark3, b: Landmark3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// MediaPipe's 21-point hand landmark indices used here: 0 wrist, 4 thumb
// tip, 6 index PIP, 8 index tip, 9 middle MCP, 12 middle tip, 16 ring tip,
// 18 pinky PIP, 20 pinky tip. Pinch distances and "extended" comparisons
// are both normalized against palm size (wrist-to-middle-MCP), so the
// gesture triggers the same whether the hand is close to or far from the
// camera.
function isCoyoteShape(lm: Landmark3[]): boolean {
  if (lm.length < 21) return false;
  const scale = dist3(lm[0], lm[9]) || 1;
  const pinchMiddle = dist3(lm[4], lm[12]) / scale < 0.55;
  const pinchRing = dist3(lm[4], lm[16]) / scale < 0.55;
  const indexExtended = dist3(lm[0], lm[8]) > dist3(lm[0], lm[6]) * 1.15;
  const pinkyExtended = dist3(lm[0], lm[20]) > dist3(lm[0], lm[18]) * 1.15;
  return pinchMiddle && pinchRing && indexExtended && pinkyExtended;
}

// Index + middle extended and held close together (not splayed into a V
// like a peace sign), ring/pinky curled in, thumb doesn't matter. The
// "together" check is what keeps this from double-firing alongside a
// peace sign, which is index+middle extended but spread apart.
function isTwoFingerPoint(lm: Landmark3[]): boolean {
  if (lm.length < 21) return false;
  const scale = dist3(lm[0], lm[9]) || 1;
  const indexExtended = dist3(lm[0], lm[8]) > dist3(lm[0], lm[6]) * 1.15;
  const middleExtended = dist3(lm[0], lm[12]) > dist3(lm[0], lm[10]) * 1.15;
  const ringCurled = dist3(lm[0], lm[16]) < dist3(lm[0], lm[14]) * 1.05;
  const pinkyCurled = dist3(lm[0], lm[20]) < dist3(lm[0], lm[18]) * 1.05;
  const fingersTogether = dist3(lm[8], lm[12]) / scale < 0.3;
  return indexExtended && middleExtended && ringCurled && pinkyCurled && fingersTogether;
}

// A swipe must cover this much of the frame width, within this long a
// window, to count — short/slow drift while just holding the pose
// shouldn't fire anything.
const SWIPE_DISTANCE = 0.15;
const SWIPE_WINDOW_MS = 600;

export async function startHandGestures(
  videoEl: HTMLVideoElement,
  { onHands, onFist, onPeaceSign, onCoyoteSign, onSwipe }: HandGestureCallbacks
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
  let wasCoyoteSign = false;
  let smoothedLeft: HandPoint | null = null;
  let smoothedRight: HandPoint | null = null;
  // Swipe tracking: armed the moment the pointing shape first appears, then
  // watches for enough net horizontal travel within the window before it
  // resets. `fired` blocks a second swipe from the same held pose — you
  // have to relax the shape and re-point to swipe again.
  let swipeAnchorX: number | null = null;
  let swipeAnchorT = 0;
  let swipeFired = false;

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

      const isCoyoteSign = result.landmarks.some((lm) => isCoyoteShape(lm));
      if (isCoyoteSign && !wasCoyoteSign) onCoyoteSign?.();
      wasCoyoteSign = isCoyoteSign;

      const pointingLm = result.landmarks.find((lm) => isTwoFingerPoint(lm));
      if (pointingLm) {
        const x = 1 - pointingLm[8].x; // mirrored, same convention as onHands
        const now = performance.now();
        if (swipeAnchorX === null) {
          swipeAnchorX = x;
          swipeAnchorT = now;
          swipeFired = false;
        } else if (!swipeFired) {
          const elapsed = now - swipeAnchorT;
          const dx = x - swipeAnchorX;
          if (elapsed <= SWIPE_WINDOW_MS && Math.abs(dx) >= SWIPE_DISTANCE) {
            onSwipe?.(dx > 0 ? "right" : "left");
            swipeFired = true;
          } else if (elapsed > SWIPE_WINDOW_MS) {
            // Window lapsed without a swipe — slide the anchor forward so
            // slow drift while holding the pose doesn't quietly accumulate
            // into a false trigger later.
            swipeAnchorX = x;
            swipeAnchorT = now;
          }
        }
      } else {
        swipeAnchorX = null;
      }
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
