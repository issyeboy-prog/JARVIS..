"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceStatus } from "@/contexts/VoiceContext";
import { startHandTracker, type HandTrackerHandle } from "@/lib/handTracker";

interface NebulaProps {
  level: number; // 0..1, smoothed audio amplitude (mic or TTS playback)
  status: VoiceStatus;
}

interface Star {
  x: number; // unit-sphere object-space coords, fixed at generation
  y: number;
  z: number;
  hue: number;
  lightness: number;
  size: number;
  twinklePhase: number;
  twinkleSpeed: number;
}

const STAR_COUNT = 650;

function buildStars(): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform distribution *within* the sphere's volume, not just its
    // surface — cube-root the radius so it doesn't clump at the center.
    const r = Math.cbrt(Math.random());
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;
    stars.push({
      x: r * Math.sin(theta) * Math.cos(phi),
      y: r * Math.sin(theta) * Math.sin(phi),
      z: r * Math.cos(theta),
      hue: 40 + Math.random() * 18, // gold -> yellow
      lightness: 55 + Math.random() * 35,
      size: 0.6 + Math.random() * 1.8,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.6 + Math.random() * 2,
    });
  }
  return stars;
}

type HandStatus = "off" | "starting" | "active" | "error";

export default function Nebula({ level, status }: NebulaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const levelRef = useRef(level);
  const statusRef = useRef(status);
  const [stars] = useState<Star[]>(buildStars);
  const starsRef = useRef(stars);

  const [handStatus, setHandStatus] = useState<HandStatus>("off");
  const handStatusRef = useRef<HandStatus>("off");
  const trackerRef = useRef<HandTrackerHandle | null>(null);

  // Rotation + drag-follow state, mutated straight from the animation and
  // motion-tracking loops — deliberately not React state, this changes far
  // too often for re-renders.
  const rotationRef = useRef({ x: 0, y: 0 });
  const angularVelocityRef = useRef({ x: 0, y: 0 });
  const currentOffsetRef = useRef({ x: 0, y: 0 });
  const targetOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    handStatusRef.current = handStatus;
  }, [handStatus]);

  const toggleHandTracking = async () => {
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
      const DRAG_SENSITIVITY = 14;
      const MAX_ANGULAR_VELOCITY = 6;
      trackerRef.current = await startHandTracker(video, {
        onMotion: (cx, cy, vx, vy) => {
          targetOffsetRef.current = {
            x: Math.max(-1, Math.min(1, (cx - 0.5) * 2)),
            y: Math.max(-1, Math.min(1, (cy - 0.5) * 2)),
          };
          angularVelocityRef.current.y = Math.max(
            -MAX_ANGULAR_VELOCITY,
            Math.min(
              MAX_ANGULAR_VELOCITY,
              angularVelocityRef.current.y + vx * DRAG_SENSITIVITY
            )
          );
          angularVelocityRef.current.x = Math.max(
            -MAX_ANGULAR_VELOCITY,
            Math.min(
              MAX_ANGULAR_VELOCITY,
              angularVelocityRef.current.x + vy * DRAG_SENSITIVITY
            )
          );
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
      const scale = Math.min(w, h) * 0.42;
      const lvl = levelRef.current;

      // Constant slow ambient spin, plus whatever hand-drag momentum is
      // active. Friction decays the drag momentum back toward the ambient
      // spin, giving a coast-to-rest "flicked trackball" feel.
      const FRICTION = 0.94;
      angularVelocityRef.current.x *= FRICTION;
      angularVelocityRef.current.y *= FRICTION;
      rotationRef.current.y += (0.12 + angularVelocityRef.current.y) * dt;
      rotationRef.current.x += angularVelocityRef.current.x * dt;

      currentOffsetRef.current.x +=
        (targetOffsetRef.current.x - currentOffsetRef.current.x) * 0.06;
      currentOffsetRef.current.y +=
        (targetOffsetRef.current.y - currentOffsetRef.current.y) * 0.06;

      const cx = w / 2 + currentOffsetRef.current.x * w * 0.16;
      const cy = h / 2 + currentOffsetRef.current.y * h * 0.16;

      ctx2d.clearRect(0, 0, w, h);

      const cosY = Math.cos(rotationRef.current.y);
      const sinY = Math.sin(rotationRef.current.y);
      const cosX = Math.cos(rotationRef.current.x);
      const sinX = Math.sin(rotationRef.current.x);

      // Ambient glow behind the whole sphere
      const glow = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, scale * 1.15);
      glow.addColorStop(0, `rgba(250, 204, 21, ${0.16 + lvl * 0.14})`);
      glow.addColorStop(1, "rgba(250, 204, 21, 0)");
      ctx2d.fillStyle = glow;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, scale * 1.15, 0, Math.PI * 2);
      ctx2d.fill();

      // Thin holographic equator rings, tilted with the sphere's rotation
      for (let i = 0; i < 2; i++) {
        const tilt = 0.28 + i * 0.4;
        const ringRy = Math.abs(Math.sin(rotationRef.current.x + tilt)) * scale * 0.9 + scale * 0.15;
        ctx2d.beginPath();
        ctx2d.ellipse(cx, cy, scale * (1.05 + i * 0.12), ringRy * 0.28, 0, 0, Math.PI * 2);
        ctx2d.strokeStyle = `rgba(56, 189, 248, ${0.22 + lvl * 0.25 - i * 0.06})`;
        ctx2d.lineWidth = 1 * dpr;
        ctx2d.stroke();
      }

      // Depth-sort stars back-to-front so nearer ones draw over farther ones
      const projected = starsRef.current.map((s) => {
        const x1 = s.x * cosY + s.z * sinY;
        const z1 = -s.x * sinY + s.z * cosY;
        const y1 = s.y * cosX - z1 * sinX;
        const z2 = s.y * sinX + z1 * cosX;
        return { s, x1, y1, z2 };
      });
      projected.sort((a, b) => a.z2 - b.z2);

      for (const { s, x1, y1, z2 } of projected) {
        const depth = (z2 + 1.15) / 2.15; // ~0.07..1
        const react = 1 + lvl * 0.5;
        const px = cx + x1 * scale * react;
        const py = cy + y1 * scale * react;
        const twinkle =
          0.55 + 0.45 * Math.sin(s.twinklePhase + now * 0.001 * s.twinkleSpeed);
        const alpha = (0.2 + depth * 0.8) * (0.6 + twinkle * 0.4 + lvl * 0.2);
        const size = s.size * dpr * (0.35 + depth * 0.85) * (1 + lvl * 0.3);

        ctx2d.beginPath();
        ctx2d.fillStyle = `hsla(${s.hue}, 90%, ${s.lightness}%, ${Math.min(alpha, 1)})`;
        ctx2d.arc(px, py, Math.max(size, 0.4), 0, Math.PI * 2);
        ctx2d.fill();
      }

      // Bright core
      const coreR = scale * (0.1 + lvl * 0.06);
      const coreGrad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.2);
      coreGrad.addColorStop(0, `rgba(255, 250, 220, ${0.85 + lvl * 0.15})`);
      coreGrad.addColorStop(1, "rgba(255, 250, 220, 0)");
      ctx2d.fillStyle = coreGrad;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, coreR * 2.2, 0, Math.PI * 2);
      ctx2d.fill();

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
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
      {/* Kept off-DOM-visible but not display:none, so mobile Chrome keeps
          decoding frames for the motion-tracking canvas to read. */}
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
