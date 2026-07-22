"use client";

import { useEffect, useRef, useState } from "react";
import { useVoice, type VoiceStatus } from "@/contexts/VoiceContext";
import {
  startHandGestures,
  type HandGestureHandle,
  type HandPoint,
} from "@/lib/handGestures";

// --- Planet data --------------------------------------------------------

interface PlanetDef {
  name: string;
  hue: number;
  relativeRadius: number; // real-world-ish proportion, used only for sort order
  hasRing?: boolean;
}

const PLANETS: PlanetDef[] = [
  { name: "Mercury", hue: 28, relativeRadius: 0.38 },
  { name: "Venus", hue: 42, relativeRadius: 0.95 },
  { name: "Earth", hue: 198, relativeRadius: 1.0 },
  { name: "Mars", hue: 12, relativeRadius: 0.53 },
  { name: "Jupiter", hue: 34, relativeRadius: 11.2 },
  { name: "Saturn", hue: 46, relativeRadius: 9.45, hasRing: true },
  { name: "Uranus", hue: 188, relativeRadius: 4.0 },
  { name: "Neptune", hue: 222, relativeRadius: 3.88 },
];
const EARTH = PLANETS.find((p) => p.name === "Earth")!;
// Earth always leads, then the rest ascending by size — not real order.
const LINEUP: PlanetDef[] = [
  EARTH,
  ...PLANETS.filter((p) => p.name !== "Earth").sort(
    (a, b) => a.relativeRadius - b.relativeRadius
  ),
];

// --- Wireframe grid geometry (module-level, deterministic, computed once) --

interface Dir {
  x: number;
  y: number;
  z: number;
}

function latLonToDir(latDeg: number, lonDeg: number): Dir {
  const theta = ((90 - latDeg) * Math.PI) / 180;
  const phi = (lonDeg * Math.PI) / 180;
  return {
    x: Math.sin(theta) * Math.cos(phi),
    y: Math.sin(theta) * Math.sin(phi),
    z: Math.cos(theta),
  };
}

const RING_RES = 32;
const LAT_RINGS: Dir[][] = [];
for (let i = 1; i < 6; i++) {
  const lat = -90 + (180 / 6) * i;
  const ring: Dir[] = [];
  for (let j = 0; j <= RING_RES; j++) {
    ring.push(latLonToDir(lat, (360 / RING_RES) * j - 180));
  }
  LAT_RINGS.push(ring);
}
const LON_MERIDIANS: Dir[][] = [];
for (let i = 0; i < 8; i++) {
  const lon = (360 / 8) * i - 180;
  const meridian: Dir[] = [];
  for (let j = 0; j <= RING_RES; j++) {
    meridian.push(latLonToDir((180 / RING_RES) * j - 90, lon));
  }
  LON_MERIDIANS.push(meridian);
}

// Deterministic pseudo-random (no Math.random at module scope) clustered
// around rough continent locations, just for a recognizable Earth silhouette.
function hash(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
const CONTINENT_CENTERS: [number, number, number][] = [
  [40, -100, 18],
  [-15, -60, 15],
  [10, 20, 20],
  [50, 30, 22],
  [30, 100, 18],
  [-25, 135, 12],
];
const CONTINENT_DIRS: Dir[] = [];
CONTINENT_CENTERS.forEach(([lat, lon, spread], ci) => {
  for (let i = 0; i < 16; i++) {
    const a = hash(ci * 100 + i) * Math.PI * 2;
    const r = hash(ci * 100 + i + 50) * spread;
    CONTINENT_DIRS.push(latLonToDir(lat + Math.sin(a) * r, lon + Math.cos(a) * r));
  }
});

const CAMERA_DIST = 2.8;

function project(
  d: Dir,
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

interface WaterState {
  tilt: number;
  phase: number;
}

// A clipped, tilting, wavy fill inside the disc — a cheap "liquid gauge"
// look rather than true fluid sim, but driven by real spring physics so it
// genuinely lags and sloshes rather than just wobbling on a fixed timer.
function drawWater(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  water: WaterState,
  hue: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
  ctx.clip();

  ctx.translate(cx, cy);
  ctx.rotate(water.tilt);

  const span = r * 3;
  const level = -r * 0.12; // waterline sits slightly above center — "filled"
  const step = Math.max(r * 0.15, 2);
  ctx.beginPath();
  ctx.moveTo(-span / 2, level);
  for (let x = -span / 2; x <= span / 2; x += step) {
    const y = level + Math.sin(x * (0.9 / r) + water.phase) * r * 0.07;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(span / 2, r * 2.5);
  ctx.lineTo(-span / 2, r * 2.5);
  ctx.closePath();
  ctx.fillStyle = `hsla(${hue}, 85%, 60%, 0.4)`;
  ctx.fill();

  ctx.restore();
}

function drawPlanet(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  cosY: number,
  sinY: number,
  cosX: number,
  sinX: number,
  planet: PlanetDef,
  detailed: boolean,
  dpr: number,
  glow: number,
  water: WaterState | null
) {
  // Ambient glow
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.4);
  g.addColorStop(0, `hsla(${planet.hue}, 90%, 65%, ${0.1 + glow * 0.12})`);
  g.addColorStop(1, `hsla(${planet.hue}, 90%, 65%, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2);
  ctx.fill();

  // Faint disc so the wireframe reads as a solid-ish holographic body
  ctx.beginPath();
  ctx.fillStyle = `hsla(${planet.hue}, 70%, 45%, 0.08)`;
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  if (water) drawWater(ctx, cx, cy, r, water, planet.hue + 160);

  const rings = detailed ? LAT_RINGS : LAT_RINGS.slice(0, 3);
  const meridians = detailed ? LON_MERIDIANS : LON_MERIDIANS.slice(0, 4);

  ctx.lineWidth = Math.max(0.6, 0.9 * dpr);
  for (const ring of rings) {
    let sumZ = 0;
    ctx.beginPath();
    ring.forEach((d, i) => {
      const p = project(d, cosY, sinY, cosX, sinX);
      sumZ += p.z;
      const px = cx + p.x * r;
      const py = cy + p.y * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    const avgZ = sumZ / ring.length;
    const alpha = 0.12 + Math.max(0, (avgZ + 1) / 2) * 0.45;
    ctx.strokeStyle = `hsla(${planet.hue}, 90%, 70%, ${alpha})`;
    ctx.stroke();
  }
  for (const meridian of meridians) {
    let sumZ = 0;
    ctx.beginPath();
    meridian.forEach((d, i) => {
      const p = project(d, cosY, sinY, cosX, sinX);
      sumZ += p.z;
      const px = cx + p.x * r;
      const py = cy + p.y * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    const avgZ = sumZ / meridian.length;
    const alpha = 0.1 + Math.max(0, (avgZ + 1) / 2) * 0.4;
    ctx.strokeStyle = `hsla(${planet.hue}, 90%, 70%, ${alpha})`;
    ctx.stroke();
  }

  if (planet.name === "Earth" && detailed) {
    for (const d of CONTINENT_DIRS) {
      const p = project(d, cosY, sinY, cosX, sinX);
      if (p.z < -0.1) continue; // far side — cull
      const px = cx + p.x * r;
      const py = cy + p.y * r;
      const alpha = 0.35 + Math.max(0, p.z) * 0.5;
      ctx.beginPath();
      ctx.fillStyle = `hsla(140, 85%, 70%, ${alpha})`;
      ctx.arc(px, py, Math.max(1.2 * dpr, r * 0.018), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (planet.hasRing) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.9, r * 0.5, 0.25, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${planet.hue}, 80%, 75%, 0.5)`;
    ctx.lineWidth = Math.max(1, 1.4 * dpr);
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
  const { micLevel, ttsLevel, status, transcript, lastResponse, activate, talkNow } =
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
  const swipeHistoryRef = useRef<{ x: number; t: number }[]>([]);
  const lastSwipeAtRef = useRef(0);
  const viewTargetRef = useRef(0); // 0 = single Earth, 1 = lineup
  const viewRef = useRef(0);

  useEffect(() => {
    levelRef.current = Math.max(micLevel, ttsLevel);
  }, [micLevel, ttsLevel]);

  // Subtitles as an audio fallback: what you said (during thinking), or
  // JARVIS's last reply otherwise. lastResponse already persists in
  // context between turns, so this doesn't need a timer to "linger" — it
  // just stays on screen, readable at your own pace, until the next
  // command overwrites it. Hidden during active listening so it doesn't
  // look like stale leftover text while a fresh command is being captured.
  const subtitle =
    status === "listening"
      ? null
      : status === "thinking" && transcript
        ? { text: `"${transcript}"`, color: "text-cyan-200" }
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
      swipeHistoryRef.current = [];

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

          const now = performance.now();
          // Swipe detection runs on raw position, independent of the
          // damped visual rotation below.
          const hist = swipeHistoryRef.current;
          hist.push({ x: drive.x, t: now });
          while (hist.length && now - hist[0].t > 300) hist.shift();
          if (hist.length > 2 && now - lastSwipeAtRef.current > 800) {
            const dx = drive.x - hist[0].x;
            if (Math.abs(dx) > 0.22) {
              lastSwipeAtRef.current = now;
              viewTargetRef.current = viewTargetRef.current === 0 ? 1 : 0;
            }
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
        onFist: () => {
          // Fist toggles the view too — a deliberate, low-precision
          // gesture fits the "less accurate, slimy" feel better than
          // demanding a clean swipe every time.
          if (performance.now() - lastSwipeAtRef.current > 800) {
            lastSwipeAtRef.current = performance.now();
            viewTargetRef.current = viewTargetRef.current === 0 ? 1 : 0;
          }
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

    // Per-planet liquid physics state (skipped for Earth). Deterministic
    // phase offsets so each planet's slosh is out of sync with the others.
    const waterStates = new Map<string, WaterState & { vel: number }>();
    LINEUP.forEach((p, i) => {
      if (p.name !== "Earth") {
        waterStates.set(p.name, { tilt: 0, vel: 0, phase: hash(i + 500) * 10 });
      }
    });

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

      viewRef.current += (viewTargetRef.current - viewRef.current) * 0.06;
      const view = viewRef.current;

      ctx.clearRect(0, 0, w, h);

      const cosY = Math.cos(rotRef.current.y);
      const sinY = Math.sin(rotRef.current.y);
      const cosX = Math.cos(rotRef.current.x);
      const sinX = Math.sin(rotRef.current.x);

      // w/h are now the full viewport, not a small boxed container, so
      // these ratios read much bigger on screen than before by design.
      const singleR = Math.min(w, h) * 0.34 * (1 + lvl * 0.05);
      const lineupR = Math.min(w, h) * 0.1;
      const centerX = w / 2;
      const centerY = h / 2;

      // Same hand-driven rotation velocity that moves the globe also drives
      // every planet's water, but as a proper lightly-damped pendulum now
      // rather than a quick proportional spring: a weak restoring force
      // plus near-1 velocity retention means it takes real time to build
      // up momentum and keeps sloshing/overshooting past level for a
      // while before finally settling, instead of just tracking the hand.
      const tiltTarget = Math.max(-0.35, Math.min(0.35, rotVelRef.current.y * 0.9));
      const RESTORING_FORCE = 0.0022;
      const INERTIA = 0.975;
      waterStates.forEach((ws) => {
        ws.vel += (tiltTarget - ws.tilt) * RESTORING_FORCE;
        ws.vel *= INERTIA;
        ws.tilt += ws.vel;
        ws.phase += 0.01 + Math.abs(ws.vel) * 4;
      });

      LINEUP.forEach((planet, i) => {
        const isEarth = planet.name === "Earth";
        // Single-view position: Earth at center, everyone else collapsed
        // to the center too (invisible, r -> 0) until the view opens up.
        const slotX =
          w * 0.5 - (LINEUP.length - 1) * (lineupR * 2.3) * 0.5 + i * lineupR * 2.3;
        const cx = centerX + (slotX - centerX) * view;
        const cy = centerY;
        const r = isEarth
          ? singleR + (lineupR - singleR) * view
          : lineupR * view;
        if (r < 1) return;

        drawPlanet(
          ctx,
          cx,
          cy,
          r,
          cosY,
          sinY,
          cosX,
          sinX,
          planet,
          isEarth && view < 0.5,
          dpr,
          lvl,
          waterStates.get(planet.name) ?? null
        );
      });

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
