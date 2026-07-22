"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceStatus } from "@/contexts/VoiceContext";

interface NebulaProps {
  level: number; // 0..1, smoothed audio amplitude (mic or TTS playback)
  status: VoiceStatus;
}

interface Arc {
  baseAngle: number;
  angle: number;
  radius: number;
  length: number; // radians
  speed: number; // radians/sec at rest
  hue: number;
  width: number;
  responseWeight: number; // per-arc variance so reaction isn't uniform
}

interface Star {
  angle: number;
  radius: number;
  size: number;
  twinklePhase: number;
  twinkleSpeed: number;
}

const ARC_COUNT = 46;
const STAR_COUNT = 60;

function buildArcs(): Arc[] {
  const arcs: Arc[] = [];
  for (let i = 0; i < ARC_COUNT; i++) {
    // Deliberately irregular distribution rather than evenly spaced —
    // clusters and gaps, like the reference star-trail photo.
    const baseAngle = Math.random() * Math.PI * 2;
    arcs.push({
      baseAngle,
      angle: baseAngle,
      radius: 0.28 + Math.random() * 0.68, // fraction of canvas half-size
      length: 0.25 + Math.random() * 1.4,
      speed: (0.05 + Math.random() * 0.18) * (Math.random() < 0.5 ? 1 : -1),
      hue: 195 + Math.random() * 70, // cyan -> blue -> violet
      width: 0.6 + Math.random() * 1.8,
      responseWeight: 0.5 + Math.random(),
    });
  }
  return arcs;
}

function buildStars(): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const r = Math.pow(Math.random(), 1.6) * 0.22; // biased toward center
    stars.push({
      angle: Math.random() * Math.PI * 2,
      radius: r,
      size: 0.6 + Math.random() * 1.8,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 1 + Math.random() * 2.5,
    });
  }
  return stars;
}

export default function Nebula({ level, status }: NebulaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  const statusRef = useRef(status);
  // Lazy initializers — generated once on mount rather than during the
  // render body itself, so the random layout is stable and side-effect-free.
  const [arcs] = useState<Arc[]>(buildArcs);
  const [stars] = useState<Star[]>(buildStars);
  // Fixed asymmetric offset for the core — the whole point is that it's
  // not dead-center.
  const [coreOffset] = useState(() => ({
    x: (Math.random() - 0.5) * 0.12,
    y: (Math.random() - 0.5) * 0.12,
  }));
  const arcsRef = useRef(arcs);
  const starsRef = useRef(stars);
  const coreOffsetRef = useRef(coreOffset);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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

    const statusColor: Record<VoiceStatus, string> = {
      inactive: "148, 163, 184", // slate
      idle: "56, 189, 248", // sky/cyan
      listening: "45, 212, 191", // teal
      thinking: "168, 85, 247", // violet
      speaking: "56, 189, 248", // cyan
    };

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2 + coreOffsetRef.current.x * w;
      const cy = h / 2 + coreOffsetRef.current.y * h;
      const scale = Math.min(w, h) / 2;
      const lvl = levelRef.current;
      const idleDrift = statusRef.current === "inactive" ? 0.15 : 0.35;
      const rgb = statusColor[statusRef.current];

      ctx2d.clearRect(0, 0, w, h);

      // Soft ambient core glow
      const coreRadius = scale * (0.12 + lvl * 0.09);
      const glowRadius = scale * (0.32 + lvl * 0.22);
      const grad = ctx2d.createRadialGradient(
        cx,
        cy,
        0,
        cx,
        cy,
        glowRadius
      );
      grad.addColorStop(0, `rgba(${rgb}, ${0.55 + lvl * 0.35})`);
      grad.addColorStop(0.35, `rgba(${rgb}, ${0.18 + lvl * 0.15})`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, glowRadius, 0, Math.PI * 2);
      ctx2d.fill();

      // Bright irregular core
      ctx2d.beginPath();
      ctx2d.fillStyle = `rgba(255, 255, 255, ${0.75 + lvl * 0.2})`;
      ctx2d.arc(cx, cy, coreRadius, 0, Math.PI * 2);
      ctx2d.fill();

      // Star cluster near the core
      for (const s of starsRef.current) {
        s.twinklePhase += dt * s.twinkleSpeed;
        const twinkle = 0.5 + 0.5 * Math.sin(s.twinklePhase);
        const x = cx + Math.cos(s.angle) * s.radius * scale;
        const y = cy + Math.sin(s.angle) * s.radius * scale;
        ctx2d.beginPath();
        ctx2d.fillStyle = `rgba(255, 255, 255, ${
          0.3 + twinkle * 0.5 + lvl * 0.2
        })`;
        ctx2d.arc(x, y, s.size * dpr * (0.8 + lvl * 0.4), 0, Math.PI * 2);
        ctx2d.fill();
      }

      // Radiating arcs, asymmetric density, audio-reactive
      for (const arc of arcsRef.current) {
        const react = lvl * arc.responseWeight;
        arc.angle += arc.speed * dt * (1 + idleDrift + react * 2.5);
        const r = scale * arc.radius * (1 + react * 0.15);
        const len = arc.length * (1 + react * 0.6);
        ctx2d.beginPath();
        ctx2d.strokeStyle = `hsla(${arc.hue}, 85%, ${
          60 + react * 15
        }%, ${0.15 + react * 0.55})`;
        ctx2d.lineWidth = arc.width * dpr * (1 + react);
        ctx2d.arc(cx, cy, r, arc.angle, arc.angle + len);
        ctx2d.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      aria-hidden="true"
    />
  );
}
