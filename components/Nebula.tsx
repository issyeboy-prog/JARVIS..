"use client";

import { useEffect, useRef, useState } from "react";
import { useVoice } from "@/contexts/VoiceContext";
import {
  startHandGestures,
  type HandGestureHandle,
  type HandPoint,
} from "@/lib/handGestures";

interface Star {
  // Precomputed unit direction (from theta/phi) so per-frame work is just
  // a scalar radius multiply, not a full re-derivation from angles.
  dirX: number;
  dirY: number;
  dirZ: number;
  theta: number;
  phi: number;
  baseR: number; // 0..1, cube-root-uniform so it fills the volume evenly
  colorStyle: string; // precomputed "hsl(...)" — built once, not templated every frame
  size: number;
  twinklePhase: number;
  twinkleSpeed: number;
  cluster: 0 | 1; // which half this star belongs to when split
}

// 1800 looked great but measured well under 60fps even outside this
// sandbox's software-rendering handicap — dialed back for headroom on
// less powerful hardware (a tablet, not a desktop GPU).
const STAR_COUNT = 1100;
// Camera distance in sphere-radius units for the perspective projection —
// small enough for real parallax depth, comfortably clear of the max
// warped radius so the denominator never approaches zero.
const CAMERA_DIST = 2.6;

function buildStars(): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;
    const hue = 40 + Math.random() * 18; // gold -> yellow
    const lightness = 55 + Math.random() * 35;
    stars.push({
      dirX: Math.sin(theta) * Math.cos(phi),
      dirY: Math.sin(theta) * Math.sin(phi),
      dirZ: Math.cos(theta),
      theta,
      phi,
      baseR: Math.cbrt(Math.random()),
      colorStyle: `hsl(${hue}, 90%, ${lightness}%)`,
      size: 0.6 + Math.random() * 1.8,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.6 + Math.random() * 2,
      cluster: Math.random() < 0.5 ? 0 : 1,
    });
  }
  return stars;
}

// Coherent (angle-based, not per-star-random) shape distortion — nearby
// stars get similar multipliers, so this bulges and pinches whole regions
// into lobes and tendrils rather than jittering each star independently.
// Slowly evolves over time so the whole mass flows like a liquid instead
// of holding a fixed asymmetric shape.
function shapeWarp(theta: number, phi: number, t: number): number {
  return (
    1 +
    0.22 * Math.sin(theta * 2.1 + phi * 1.3 + t * 1.1) +
    0.14 * Math.sin(theta * 4.3 - phi * 2.4 + t * 1.7) +
    0.1 * Math.sin(phi * 3.1 + theta * 1.7 + t * 0.8)
  );
}

type HandStatus = "off" | "starting" | "active" | "error";

export default function Nebula() {
  const { micLevel, ttsLevel, status, activate, talkNow } = useVoice();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const levelRef = useRef(0);
  const [stars] = useState<Star[]>(buildStars);
  const starsRef = useRef(stars);

  const [handStatus, setHandStatus] = useState<HandStatus>("off");
  const trackerRef = useRef<HandGestureHandle | null>(null);

  // Rotation + drag-follow state, mutated straight from the animation and
  // hand-tracking loops — deliberately not React state, this changes far
  // too often for re-renders.
  const rotationRef = useRef({ x: 0, y: 0 });
  const angularVelocityRef = useRef({ x: 0, y: 0 });
  const currentOffsetRef = useRef({ x: 0, y: 0 });
  const targetOffsetRef = useRef({ x: 0, y: 0 });
  const lastDrivePosRef = useRef<HandPoint | null>(null);
  // Decays back to 0 each frame — a fist-close briefly spikes this to
  // drive the shockwave/bounce effect.
  const bounceRef = useRef(0);
  // Latest smoothed hand positions and the split amount eased toward 1
  // when both hands are present, 0 otherwise.
  const handsRef = useRef<{ left: HandPoint | null; right: HandPoint | null }>({
    left: null,
    right: null,
  });
  const splitRef = useRef(0);

  useEffect(() => {
    // React to whichever source is currently louder — you talking or
    // JARVIS talking — so the sphere always reflects live voice activity.
    levelRef.current = Math.max(micLevel, ttsLevel);
  }, [micLevel, ttsLevel]);

  const toggleHandTracking = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (trackerRef.current) {
      trackerRef.current.stop();
      trackerRef.current = null;
      setHandStatus("off");
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    setHandStatus("starting");
    try {
      // Direct drag: rotation tracks hand movement almost 1:1 as it moves.
      const DRAG_SENSITIVITY = 26;
      // Smaller contribution to momentum, so it keeps coasting briefly
      // after the hand stops rather than snapping dead.
      const MOMENTUM_SENSITIVITY = 9;
      const MAX_ANGULAR_VELOCITY = 10;
      lastDrivePosRef.current = null;

      trackerRef.current = await startHandGestures(video, {
        onHands: (hands) => {
          handsRef.current = hands;

          const drive =
            hands.left && hands.right
              ? {
                  x: (hands.left.x + hands.right.x) / 2,
                  y: (hands.left.y + hands.right.y) / 2,
                }
              : hands.left ?? hands.right;
          if (!drive) {
            lastDrivePosRef.current = null;
            return;
          }

          targetOffsetRef.current = {
            x: Math.max(-1, Math.min(1, (drive.x - 0.5) * 2)),
            y: Math.max(-1, Math.min(1, (drive.y - 0.5) * 2)),
          };

          const last = lastDrivePosRef.current;
          if (last) {
            const dx = drive.x - last.x;
            const dy = drive.y - last.y;
            rotationRef.current.y += dx * DRAG_SENSITIVITY;
            rotationRef.current.x += dy * DRAG_SENSITIVITY;
            angularVelocityRef.current.y = Math.max(
              -MAX_ANGULAR_VELOCITY,
              Math.min(
                MAX_ANGULAR_VELOCITY,
                angularVelocityRef.current.y + dx * MOMENTUM_SENSITIVITY
              )
            );
            angularVelocityRef.current.x = Math.max(
              -MAX_ANGULAR_VELOCITY,
              Math.min(
                MAX_ANGULAR_VELOCITY,
                angularVelocityRef.current.x + dy * MOMENTUM_SENSITIVITY
              )
            );
          }
          lastDrivePosRef.current = drive;
        },
        onFist: () => {
          bounceRef.current = 1;
        },
      });
      setHandStatus("active");
    } catch {
      setHandStatus("error");
    }
  };

  useEffect(() => {
    return () => {
      trackerRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    // Preallocated once, reused every frame — avoids allocating a fresh
    // object per star per frame (was ~1100 allocations/frame of GC churn).
    const stars = starsRef.current;
    const n = stars.length;
    const projX = new Float32Array(n);
    const projY = new Float32Array(n);
    const projPersp = new Float32Array(n);
    const indices = new Uint16Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;

    let raf = 0;
    let last = performance.now();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const w = canvas.width;
      const h = canvas.height;
      const baseScale = Math.min(w, h) * 0.46;
      const lvl = levelRef.current;
      const warpT = now * 0.00035;

      // Liquid "breathing" — a slow ambient pulsation independent of audio,
      // so the whole thing never sits perfectly still even in silence.
      const breathe = 1 + Math.sin(now * 0.0006) * 0.035;
      const scale = baseScale * breathe;

      const FRICTION = 0.92;
      angularVelocityRef.current.x *= FRICTION;
      angularVelocityRef.current.y *= FRICTION;
      rotationRef.current.y += (0.1 + angularVelocityRef.current.y) * dt;
      rotationRef.current.x += angularVelocityRef.current.x * dt;

      // Snappier follow — tightened up from the previous pass, which felt
      // laggy.
      currentOffsetRef.current.x +=
        (targetOffsetRef.current.x - currentOffsetRef.current.x) * 0.35;
      currentOffsetRef.current.y +=
        (targetOffsetRef.current.y - currentOffsetRef.current.y) * 0.35;

      const mergedCx = w / 2 + currentOffsetRef.current.x * w * 0.32;
      const mergedCy = h / 2 + currentOffsetRef.current.y * h * 0.32;

      // Ease the split amount toward 1 when both hands are present.
      const bothHands = !!(handsRef.current.left && handsRef.current.right);
      splitRef.current += ((bothHands ? 1 : 0) - splitRef.current) * 0.08;
      const split = splitRef.current;

      const leftScreen = handsRef.current.left
        ? { x: handsRef.current.left.x * w, y: handsRef.current.left.y * h }
        : { x: mergedCx, y: mergedCy };
      const rightScreen = handsRef.current.right
        ? { x: handsRef.current.right.x * w, y: handsRef.current.right.y * h }
        : { x: mergedCx, y: mergedCy };

      const centerA = {
        x: mergedCx + (leftScreen.x - mergedCx) * split,
        y: mergedCy + (leftScreen.y - mergedCy) * split,
      };
      const centerB = {
        x: mergedCx + (rightScreen.x - mergedCx) * split,
        y: mergedCy + (rightScreen.y - mergedCy) * split,
      };
      const clusterScale = scale * (1 - split * 0.45);

      // Fist-close shockwave: spikes to 1 in the tracker callback, decays
      // back out over the next ~15-20 frames.
      const bounce = bounceRef.current;
      bounceRef.current *= 0.87;

      ctx2d.clearRect(0, 0, w, h);

      const cosY = Math.cos(rotationRef.current.y);
      const sinY = Math.sin(rotationRef.current.y);
      const cosX = Math.cos(rotationRef.current.x);
      const sinX = Math.sin(rotationRef.current.x);

      const drawGlowAndRings = (cx: number, cy: number, sc: number) => {
        const glowRadius = sc * (1.15 + bounce * 0.35);
        const glow = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
        glow.addColorStop(0, `rgba(250, 204, 21, ${0.16 + lvl * 0.14 + bounce * 0.3})`);
        glow.addColorStop(1, "rgba(250, 204, 21, 0)");
        ctx2d.fillStyle = glow;
        ctx2d.beginPath();
        ctx2d.arc(cx, cy, glowRadius, 0, Math.PI * 2);
        ctx2d.fill();

        for (let i = 0; i < 2; i++) {
          const tilt = 0.28 + i * 0.4;
          const ringRy =
            Math.abs(Math.sin(rotationRef.current.x + tilt)) * sc * 0.9 + sc * 0.15;
          ctx2d.beginPath();
          ctx2d.ellipse(cx, cy, sc * (1.05 + i * 0.12), ringRy * 0.28, 0, 0, Math.PI * 2);
          ctx2d.strokeStyle = `rgba(56, 189, 248, ${0.22 + lvl * 0.25 - i * 0.06})`;
          ctx2d.lineWidth = 1 * dpr;
          ctx2d.stroke();
        }
      };

      drawGlowAndRings(centerA.x, centerA.y, clusterScale);
      if (split > 0.03) drawGlowAndRings(centerB.x, centerB.y, clusterScale);

      // Depth-sort stars back-to-front so nearer ones draw over farther
      // ones. Position now comes from a real perspective projection
      // (divide by camera-relative depth) instead of orthographic +
      // shading, so rotation actually reads as 3D parallax. Writes into
      // preallocated typed arrays rather than mapping to fresh objects.
      for (let i = 0; i < n; i++) {
        const s = stars[i];
        const warp = shapeWarp(s.theta, s.phi, warpT);
        const r = s.baseR * warp;
        const x = s.dirX * r;
        const y = s.dirY * r;
        const z = s.dirZ * r;

        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;
        const y1 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        projX[i] = x1;
        projY[i] = y1;
        projPersp[i] = CAMERA_DIST / (CAMERA_DIST - z2);
      }
      indices.sort((a, b) => projPersp[a] - projPersp[b]);

      for (let k = 0; k < n; k++) {
        const i = indices[k];
        const s = stars[i];
        const persp = projPersp[i];
        const depth = Math.min(Math.max((persp - 0.6) / 1.7, 0), 1);
        const react = (1 + lvl * 0.5 + bounce * 0.8) * persp;

        const { x: cx, y: cy } = s.cluster === 0 ? centerA : centerB;
        const px = cx + projX[i] * clusterScale * react;
        const py = cy + projY[i] * clusterScale * react;
        const twinkle =
          0.55 + 0.45 * Math.sin(s.twinklePhase + now * 0.001 * s.twinkleSpeed);
        const alpha = (0.15 + depth * 0.85) * (0.6 + twinkle * 0.4 + lvl * 0.2 + bounce * 0.3);
        const size = s.size * dpr * (0.25 + depth * 1.1) * (1 + lvl * 0.3 + bounce * 0.5);

        // Reused precomputed color string + globalAlpha instead of
        // templating a fresh hsla() string per star per frame — cuts a
        // meaningful chunk of GC churn at this star count.
        ctx2d.globalAlpha = Math.min(alpha, 1);
        ctx2d.fillStyle = s.colorStyle;
        ctx2d.beginPath();
        ctx2d.arc(px, py, Math.max(size, 0.35), 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.globalAlpha = 1;

      const drawCore = (cx: number, cy: number, sc: number) => {
        const coreR = sc * (0.1 + lvl * 0.06 + bounce * 0.08);
        const coreGrad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.2);
        coreGrad.addColorStop(0, `rgba(255, 250, 220, ${Math.min(0.85 + lvl * 0.15 + bounce * 0.2, 1)})`);
        coreGrad.addColorStop(1, "rgba(255, 250, 220, 0)");
        ctx2d.fillStyle = coreGrad;
        ctx2d.beginPath();
        ctx2d.arc(cx, cy, coreR * 2.2, 0, Math.PI * 2);
        ctx2d.fill();
      };

      drawCore(centerA.x, centerA.y, clusterScale);
      if (split > 0.03) drawCore(centerB.x, centerB.y, clusterScale);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const handLabel: Record<HandStatus, string> = {
    off: "✋ Enable hand tracking",
    starting: "Requesting camera…",
    active: "✋ Tracking — tap to stop",
    error: "Camera unavailable",
  };

  return (
    <div
      className="relative h-full w-full cursor-pointer"
      onClick={() => (status === "inactive" ? activate() : talkNow())}
      role="button"
      aria-label={status === "inactive" ? "Activate JARVIS" : "Talk to JARVIS"}
    >
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
      {/* Kept off-DOM-visible but not display:none, so mobile Chrome keeps
          decoding frames for the tracking model to read. */}
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
      <button
        onClick={toggleHandTracking}
        disabled={handStatus === "starting"}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-cyan-400/30 bg-black/30 px-4 py-1.5 text-[11px] uppercase tracking-widest text-cyan-200/80 backdrop-blur transition hover:bg-cyan-500/10 disabled:opacity-50"
      >
        {handLabel[handStatus]}
      </button>
    </div>
  );
}
