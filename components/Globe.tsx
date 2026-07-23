"use client";

import { useEffect, useRef, useState } from "react";
import { useVoice, type VoiceStatus } from "@/contexts/VoiceContext";
import {
  startHandGestures,
  type HandGestureHandle,
  type HandPoint,
} from "@/lib/handGestures";

// --- Body-space armor geometry (module-level, deterministic, computed once) --
//
// A wireframe humanoid suit built from simple boxes in a loose y-up body
// coordinate system (roughly -1.3..1.3). Each part has an "explode
// direction" — its rest position relative to a central core — so a peace
// sign can space every piece outward along a natural radial path (like an
// exhibit's exploded diagram) and a fist can pull them back together.

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function normalize(v: Vec3): Vec3 {
  const len = length(v) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

interface ArmorPartDef {
  id: string;
  center: Vec3;
  half: Vec3; // box half-extents
}

// Roughly: head, chest, abdomen, then paired left/right arm (upper/fore/
// hand) and leg (thigh/shin/foot) segments — enough pieces to read as
// armor without being expensive to draw at 60fps in a 2D canvas.
const CORE: Vec3 = { x: 0, y: 0.45, z: 0 };
const ARMOR_PARTS: ArmorPartDef[] = [
  { id: "head", center: { x: 0, y: 1.15, z: 0 }, half: { x: 0.16, y: 0.19, z: 0.17 } },
  { id: "chest", center: { x: 0, y: 0.62, z: 0 }, half: { x: 0.36, y: 0.4, z: 0.24 } },
  { id: "abdomen", center: { x: 0, y: 0.14, z: 0 }, half: { x: 0.27, y: 0.18, z: 0.2 } },

  { id: "armL_upper", center: { x: -0.52, y: 0.42, z: 0 }, half: { x: 0.1, y: 0.22, z: 0.11 } },
  { id: "armL_fore", center: { x: -0.56, y: 0.02, z: 0 }, half: { x: 0.085, y: 0.19, z: 0.095 } },
  { id: "armL_hand", center: { x: -0.58, y: -0.28, z: 0 }, half: { x: 0.075, y: 0.09, z: 0.08 } },
  { id: "armR_upper", center: { x: 0.52, y: 0.42, z: 0 }, half: { x: 0.1, y: 0.22, z: 0.11 } },
  { id: "armR_fore", center: { x: 0.56, y: 0.02, z: 0 }, half: { x: 0.085, y: 0.19, z: 0.095 } },
  { id: "armR_hand", center: { x: 0.58, y: -0.28, z: 0 }, half: { x: 0.075, y: 0.09, z: 0.08 } },

  { id: "legL_thigh", center: { x: -0.18, y: -0.38, z: 0 }, half: { x: 0.14, y: 0.26, z: 0.15 } },
  { id: "legL_shin", center: { x: -0.18, y: -0.85, z: 0 }, half: { x: 0.11, y: 0.24, z: 0.12 } },
  { id: "legL_foot", center: { x: -0.18, y: -1.14, z: 0.06 }, half: { x: 0.1, y: 0.06, z: 0.17 } },
  { id: "legR_thigh", center: { x: 0.18, y: -0.38, z: 0 }, half: { x: 0.14, y: 0.26, z: 0.15 } },
  { id: "legR_shin", center: { x: 0.18, y: -0.85, z: 0 }, half: { x: 0.11, y: 0.24, z: 0.12 } },
  { id: "legR_foot", center: { x: 0.18, y: -1.14, z: 0.06 }, half: { x: 0.1, y: 0.06, z: 0.17 } },
];

function hash(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

interface ArmorPart extends ArmorPartDef {
  explodeDir: Vec3;
  explodeScale: number; // per-part variation so the spread looks organic, not uniform
  corners: Vec3[]; // 8 rest-position box corners, precomputed once
}

const BOX_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0], // bottom face
  [4, 5], [5, 6], [6, 7], [7, 4], // top face
  [0, 4], [1, 5], [2, 6], [3, 7], // verticals
];

function boxCorners(c: Vec3, h: Vec3): Vec3[] {
  return [
    { x: c.x - h.x, y: c.y - h.y, z: c.z - h.z },
    { x: c.x + h.x, y: c.y - h.y, z: c.z - h.z },
    { x: c.x + h.x, y: c.y - h.y, z: c.z + h.z },
    { x: c.x - h.x, y: c.y - h.y, z: c.z + h.z },
    { x: c.x - h.x, y: c.y + h.y, z: c.z - h.z },
    { x: c.x + h.x, y: c.y + h.y, z: c.z - h.z },
    { x: c.x + h.x, y: c.y + h.y, z: c.z + h.z },
    { x: c.x - h.x, y: c.y + h.y, z: c.z + h.z },
  ];
}

const ARMOR: ArmorPart[] = ARMOR_PARTS.map((def, i) => ({
  ...def,
  explodeDir: normalize(sub(def.center, CORE)),
  explodeScale: 0.8 + hash(i + 900) * 0.4, // 0.8..1.2
  corners: boxCorners(def.center, def.half),
}));

const HUE = 190; // cyan, matching the rest of the holographic UI
const CORE_HUE = 42; // small warm "reactor" accent at the chest

const CAMERA_DIST = 3.6;

function project(
  d: Vec3,
  cosY: number,
  sinY: number,
  cosX: number,
  sinX: number
) {
  const x1 = d.x * cosY + d.z * sinY;
  const z1 = -d.x * sinY + d.z * cosY;
  const y1 = d.y * cosX - z1 * sinX;
  const z2 = d.y * sinX + z1 * cosX;
  const persp = CAMERA_DIST / (CAMERA_DIST - z2);
  return { x: x1 * persp, y: y1 * persp, z: z2 };
}

// How far a fully-exploded part travels from its assembled position, in
// body-space units.
const EXPLODE_DIST = 0.62;

function drawArmorPart(
  ctx: CanvasRenderingContext2D,
  part: ArmorPart,
  explode: number,
  cosY: number,
  sinY: number,
  cosX: number,
  sinX: number,
  scale: number,
  cx: number,
  cy: number,
  dpr: number
) {
  const offset: Vec3 = {
    x: part.explodeDir.x * explode * EXPLODE_DIST * part.explodeScale,
    y: part.explodeDir.y * explode * EXPLODE_DIST * part.explodeScale,
    z: part.explodeDir.z * explode * EXPLODE_DIST * part.explodeScale,
  };

  // A faint tether from the assembled position to the exploded one — the
  // callout-line look of an exploded diagram, only visible mid-transition.
  if (explode > 0.02) {
    const restP = project(part.center, cosY, sinY, cosX, sinX);
    const outP = project(
      { x: part.center.x + offset.x, y: part.center.y + offset.y, z: part.center.z + offset.z },
      cosY, sinY, cosX, sinX
    );
    ctx.beginPath();
    ctx.moveTo(cx + restP.x * scale, cy - restP.y * scale);
    ctx.lineTo(cx + outP.x * scale, cy - outP.y * scale);
    ctx.strokeStyle = `hsla(${HUE}, 80%, 70%, ${0.12 * explode})`;
    ctx.lineWidth = Math.max(0.5, 0.6 * dpr);
    ctx.stroke();
  }

  const projected = part.corners.map((c) =>
    project(
      { x: c.x + offset.x, y: c.y + offset.y, z: c.z + offset.z },
      cosY, sinY, cosX, sinX
    )
  );

  ctx.lineWidth = Math.max(0.7, 1 * dpr);
  for (const [a, b] of BOX_EDGES) {
    const pa = projected[a];
    const pb = projected[b];
    const avgZ = (pa.z + pb.z) / 2;
    const alpha = 0.2 + Math.max(0, (avgZ + 1) / 2) * 0.6;
    ctx.strokeStyle = `hsla(${HUE}, 90%, 70%, ${Math.min(1, alpha)})`;
    ctx.beginPath();
    ctx.moveTo(cx + pa.x * scale, cy - pa.y * scale);
    ctx.lineTo(cx + pb.x * scale, cy - pb.y * scale);
    ctx.stroke();
  }
}

// --- Component -----------------------------------------------------------

const STATUS_LABEL: Record<VoiceStatus, string> = {
  inactive: "TAP TO ACTIVATE",
  idle: "◇ ARMED",
  listening: "◆ LISTENING",
  thinking: "◈ THINKING",
  speaking: "◆ SPEAKING",
};

type HandStatus = "off" | "starting" | "active" | "error";

export default function Globe() {
  const { micLevel, ttsLevel, status, transcript, lastResponse, lastError, activate, talkNow } =
    useVoice();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const levelRef = useRef(0);

  const [handStatus, setHandStatus] = useState<HandStatus>("off");
  const trackerRef = useRef<HandGestureHandle | null>(null);

  // Target (snappy, raw) rotation driven directly by hand movement, and the
  // actual rendered rotation, which lags/wobbles toward the target with
  // heavy spring damping — that gap is what reads as "slimy."
  const targetRotRef = useRef({ x: 0, y: 0 });
  const rotRef = useRef({ x: 0, y: 0 });
  const rotVelRef = useRef({ x: 0, y: 0 });

  const lastHandPosRef = useRef<HandPoint | null>(null);
  // 0 = assembled suit, 1 = fully exploded/examined. A peace sign opens it
  // up, a fist reassembles it — target snaps instantly, the rendered value
  // eases toward it for a smooth open/close rather than a jump cut.
  const explodeTargetRef = useRef(0);
  const explodeRef = useRef(0);

  useEffect(() => {
    levelRef.current = Math.max(micLevel, ttsLevel);
  }, [micLevel, ttsLevel]);

  // Subtitles as an audio fallback: what you said (during thinking), or
  // JARVIS's last reply otherwise. lastResponse already persists in
  // context between turns, so this doesn't need a timer to "linger" — it
  // just stays on screen, readable at your own pace, until the next
  // command overwrites it. Hidden during active listening so it doesn't
  // look like stale leftover text while a fresh command is being captured.
  // A failed attempt (e.g. recognition timeout) now shows an explicit
  // error instead of silently reverting to idle with nothing on screen.
  const subtitle =
    status === "listening"
      ? null
      : status === "thinking" && transcript
        ? { text: `"${transcript}"`, color: "text-cyan-200" }
        : lastError
          ? { text: lastError, color: "text-amber-300" }
          : lastResponse
            ? { text: lastResponse, color: "text-emerald-300" }
            : null;

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
      lastHandPosRef.current = null;

      trackerRef.current = await startHandGestures(video, {
        onHands: (hands) => {
          const drive =
            hands.left && hands.right
              ? {
                  x: (hands.left.x + hands.right.x) / 2,
                  y: (hands.left.y + hands.right.y) / 2,
                }
              : hands.left ?? hands.right;
          if (!drive) {
            lastHandPosRef.current = null;
            return;
          }

          const last = lastHandPosRef.current;
          if (last) {
            const dx = drive.x - last.x;
            const dy = drive.y - last.y;
            const DRAG_SENSITIVITY = 22;
            targetRotRef.current.y += dx * DRAG_SENSITIVITY;
            targetRotRef.current.x += dy * DRAG_SENSITIVITY;
          }
          lastHandPosRef.current = drive;
        },
        // Peace sign: space every armor part outward, like examining an
        // exploded diagram of the suit.
        onPeaceSign: () => {
          explodeTargetRef.current = 1;
        },
        // Closed fist: pull everything back into the assembled suit.
        onFist: () => {
          explodeTargetRef.current = 0;
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
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

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const lvl = levelRef.current;

      // Slow constant drift so it's never fully static, plus whatever the
      // hand is driving.
      targetRotRef.current.y += 0.001;

      // Viscous spring: rendered rotation chases the target with heavy
      // damping and a little overshoot — loose and gooey, not precise.
      const STIFFNESS = 0.02;
      const DAMPING = 0.82;
      const errX = targetRotRef.current.x - rotRef.current.x;
      const errY = targetRotRef.current.y - rotRef.current.y;
      rotVelRef.current.x = rotVelRef.current.x * DAMPING + errX * STIFFNESS;
      rotVelRef.current.y = rotVelRef.current.y * DAMPING + errY * STIFFNESS;
      rotRef.current.x += rotVelRef.current.x;
      rotRef.current.y += rotVelRef.current.y;

      explodeRef.current += (explodeTargetRef.current - explodeRef.current) * 0.06;

      ctx.clearRect(0, 0, w, h);

      const cosY = Math.cos(rotRef.current.y);
      const sinY = Math.sin(rotRef.current.y);
      const cosX = Math.cos(rotRef.current.x);
      const sinX = Math.sin(rotRef.current.x);

      const centerX = w / 2;
      const centerY = h / 2;
      // Leaves headroom for parts to spread out on explode without
      // running off-screen — full viewport, not a boxed widget.
      const scale = Math.min(w, h) * 0.24 * (1 + lvl * 0.04);

      // One soft ambient glow behind the whole figure rather than one per
      // part — cheaper, and reads as a single holographic projection
      // rather than a dozen separate glowing blobs.
      const glowR = scale * (1.7 + explodeRef.current * 0.9);
      const g = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowR);
      g.addColorStop(0, `hsla(${HUE}, 90%, 65%, ${0.08 + lvl * 0.1})`);
      g.addColorStop(1, `hsla(${HUE}, 90%, 65%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(centerX, centerY, glowR, 0, Math.PI * 2);
      ctx.fill();

      for (const part of ARMOR) {
        drawArmorPart(
          ctx, part, explodeRef.current, cosY, sinY, cosX, sinX, scale, centerX, centerY, dpr
        );
      }

      // A small pulsing "reactor" core at the chest — fades out once the
      // chest plate has moved away from center during the explode.
      const chestP = project(
        {
          x: CORE.x,
          y: CORE.y,
          z: CORE.z + 0.2,
        },
        cosY, sinY, cosX, sinX
      );
      const coreAlpha = (0.5 + lvl * 0.4) * (1 - explodeRef.current * 0.7);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${CORE_HUE}, 95%, 70%, ${coreAlpha})`;
      ctx.arc(
        centerX + chestP.x * scale,
        centerY - chestP.y * scale,
        Math.max(1.5 * dpr, scale * 0.035),
        0,
        Math.PI * 2
      );
      ctx.fill();

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
    // Fixed full-viewport, deliberately outside the panel grid's flow — a
    // holographic projection isn't boxed into a widget, it fills the room.
    // Panels above it get their own stacking context (z-10) so they still
    // render legibly on top; clicking a panel hits the panel, clicking any
    // open space hits the globe underneath.
    <div
      className="fixed inset-0 z-0 cursor-pointer"
      onClick={() => (status === "inactive" ? activate() : talkNow())}
      role="button"
      aria-label={status === "inactive" ? "Activate JARVIS" : "Talk to JARVIS"}
    >
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
      <div className="absolute top-[30%] left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-[0.3em] text-cyan-300/70 holo-text">
        {STATUS_LABEL[status]}
      </div>
      {subtitle && (
        <div className="pointer-events-none absolute top-[68%] left-1/2 w-[85%] max-w-md -translate-x-1/2 text-center">
          <p
            className={`rounded-md bg-black/40 px-3 py-1.5 text-sm backdrop-blur-sm ${subtitle.color}`}
          >
            {subtitle.text}
          </p>
        </div>
      )}
      <button
        onClick={toggleHandTracking}
        disabled={handStatus === "starting"}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-cyan-400/30 bg-black/30 px-4 py-1.5 text-[11px] uppercase tracking-widest text-cyan-200/80 backdrop-blur transition hover:bg-cyan-500/10 disabled:opacity-50"
      >
        {handLabel[handStatus]}
      </button>
    </div>
  );
}
