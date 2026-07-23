"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { useVoice, type VoiceStatus } from "@/contexts/VoiceContext";
import {
  startHandGestures,
  type HandGestureHandle,
  type HandPoint,
} from "@/lib/handGestures";

// --- Body-space armor rig -------------------------------------------------
//
// An original, hand-authored armor design — no licensed model or ripped
// assets, just primitive geometry (rounded panels, rings, spheres) built
// into a loose y-up body rig and rendered with real lighting/materials
// instead of flat wireframe lines. Each part knows its own "explode
// direction" — its rest position relative to a central core — so a peace
// sign can space every piece outward along a natural radial path (an
// exhibit's exploded diagram) and a fist pulls it back together, both
// driven by actual Object3D transforms rather than manual per-frame
// projection math.

interface PartDef {
  id: string;
  center: THREE.Vector3;
  half: THREE.Vector3;
}

const CORE = new THREE.Vector3(0, 0.45, 0);

const PART_DEFS: PartDef[] = [
  { id: "head_dome", center: new THREE.Vector3(0, 1.22, 0), half: new THREE.Vector3(0.145, 0.12, 0.145) },
  { id: "head_jaw", center: new THREE.Vector3(0, 1.03, 0.02), half: new THREE.Vector3(0.12, 0.09, 0.155) },
  { id: "chest", center: new THREE.Vector3(0, 0.62, 0), half: new THREE.Vector3(0.36, 0.4, 0.24) },
  { id: "abdomen", center: new THREE.Vector3(0, 0.14, 0), half: new THREE.Vector3(0.27, 0.18, 0.2) },

  { id: "shoulderL", center: new THREE.Vector3(-0.5, 0.74, 0.01), half: new THREE.Vector3(0.155, 0.11, 0.14) },
  { id: "armL_upper", center: new THREE.Vector3(-0.52, 0.42, 0), half: new THREE.Vector3(0.1, 0.22, 0.11) },
  { id: "armL_fore", center: new THREE.Vector3(-0.56, 0.02, 0), half: new THREE.Vector3(0.085, 0.19, 0.095) },
  { id: "armL_hand", center: new THREE.Vector3(-0.58, -0.28, 0), half: new THREE.Vector3(0.09, 0.1, 0.09) },
  { id: "shoulderR", center: new THREE.Vector3(0.5, 0.74, 0.01), half: new THREE.Vector3(0.155, 0.11, 0.14) },
  { id: "armR_upper", center: new THREE.Vector3(0.52, 0.42, 0), half: new THREE.Vector3(0.1, 0.22, 0.11) },
  { id: "armR_fore", center: new THREE.Vector3(0.56, 0.02, 0), half: new THREE.Vector3(0.085, 0.19, 0.095) },
  { id: "armR_hand", center: new THREE.Vector3(0.58, -0.28, 0), half: new THREE.Vector3(0.09, 0.1, 0.09) },

  { id: "legL_thigh", center: new THREE.Vector3(-0.18, -0.38, 0), half: new THREE.Vector3(0.14, 0.26, 0.15) },
  { id: "legL_shin", center: new THREE.Vector3(-0.18, -0.85, 0), half: new THREE.Vector3(0.11, 0.24, 0.12) },
  { id: "legL_foot", center: new THREE.Vector3(-0.18, -1.15, 0.06), half: new THREE.Vector3(0.12, 0.07, 0.19) },
  { id: "legR_thigh", center: new THREE.Vector3(0.18, -0.38, 0), half: new THREE.Vector3(0.14, 0.26, 0.15) },
  { id: "legR_shin", center: new THREE.Vector3(0.18, -0.85, 0), half: new THREE.Vector3(0.11, 0.24, 0.12) },
  { id: "legR_foot", center: new THREE.Vector3(0.18, -1.15, 0.06), half: new THREE.Vector3(0.12, 0.07, 0.19) },
];

interface JointDef {
  position: THREE.Vector3;
  followPartId: string;
}

// Small sensor rings at the joints — shoulders, elbows, wrists, hips,
// knees, ankles, neck. Parented to whichever part they anchor to, so
// they travel with it automatically during explode/reassemble.
const JOINT_DEFS: JointDef[] = [
  { position: new THREE.Vector3(0, 0.96, 0.03), followPartId: "head_jaw" },
  { position: new THREE.Vector3(-0.5, 0.6, 0.02), followPartId: "shoulderL" },
  { position: new THREE.Vector3(0.5, 0.6, 0.02), followPartId: "shoulderR" },
  { position: new THREE.Vector3(-0.55, 0.2, 0), followPartId: "armL_fore" },
  { position: new THREE.Vector3(0.55, 0.2, 0), followPartId: "armR_fore" },
  { position: new THREE.Vector3(-0.57, -0.15, 0), followPartId: "armL_hand" },
  { position: new THREE.Vector3(0.57, -0.15, 0), followPartId: "armR_hand" },
  { position: new THREE.Vector3(-0.18, -0.13, 0.02), followPartId: "legL_thigh" },
  { position: new THREE.Vector3(0.18, -0.13, 0.02), followPartId: "legR_thigh" },
  { position: new THREE.Vector3(-0.18, -0.62, 0), followPartId: "legL_shin" },
  { position: new THREE.Vector3(0.18, -0.62, 0), followPartId: "legR_shin" },
  { position: new THREE.Vector3(-0.18, -1.0, 0.05), followPartId: "legL_foot" },
  { position: new THREE.Vector3(0.18, -1.0, 0.05), followPartId: "legR_foot" },
];

// Glowing "eye slit" points on the jaw plate.
const EYE_DEFS = [
  new THREE.Vector3(-0.055, 1.05, 0.16),
  new THREE.Vector3(0.055, 1.05, 0.16),
];

function hash(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// How far a fully-exploded part travels from its assembled position, in
// body-space units.
const EXPLODE_DIST = 0.62;
const PANEL_RADIUS = 0.03;
const HUE_HEX = 0x38bdf8; // cyan, matching the rest of the holographic UI
const EDGE_HEX = 0x7dd3fc;
const REACTOR_HEX = 0xf5a524; // warm amber accent

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
  // 0 = assembled suit, 1 = fully exploded/examined.
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

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(0, 0.02, 4.7);
    camera.lookAt(0, 0.05, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);

    // Lighting — soft fill plus a cool key light and a warm rim, so the
    // panels actually catch highlights as they rotate rather than reading
    // as a flat silhouette.
    scene.add(new THREE.HemisphereLight(0x8fd9ff, 0x0a0f1a, 0.55));
    const key = new THREE.DirectionalLight(0x8fe0ff, 1.2);
    key.position.set(1.6, 2.2, 2.4);
    scene.add(key);
    const rimLight = new THREE.PointLight(0x66eaff, 1.4, 8, 2);
    rimLight.position.set(-1.8, 0.6, -1.6);
    scene.add(rimLight);

    const root = new THREE.Group();
    scene.add(root);

    const armorMat = new THREE.MeshPhysicalMaterial({
      color: 0x123246,
      emissive: HUE_HEX,
      emissiveIntensity: 0.16,
      metalness: 0.55,
      roughness: 0.28,
      transparent: true,
      opacity: 0.62,
      transmission: 0.05,
      thickness: 0.3,
      side: THREE.DoubleSide,
    });
    const edgeMat = new THREE.LineBasicMaterial({
      color: EDGE_HEX,
      transparent: true,
      opacity: 0.85,
    });

    interface PartHandle {
      def: PartDef;
      group: THREE.Group;
      explodeDir: THREE.Vector3;
      explodeScale: number;
    }
    const parts = new Map<string, PartHandle>();

    PART_DEFS.forEach((def, i) => {
      const geo = new RoundedBoxGeometry(def.half.x * 2, def.half.y * 2, def.half.z * 2, 3, PANEL_RADIUS);
      const mesh = new THREE.Mesh(geo, armorMat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edgeMat);
      const group = new THREE.Group();
      group.position.copy(def.center);
      group.add(mesh, edges);
      root.add(group);

      const dir = def.center.clone().sub(CORE);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();

      parts.set(def.id, { def, group, explodeDir: dir, explodeScale: 0.8 + hash(i + 900) * 0.4 });
    });

    const jointGeo = new THREE.TorusGeometry(0.034, 0.008, 8, 20);
    const jointDotGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const jointMat = new THREE.MeshBasicMaterial({ color: EDGE_HEX, transparent: true, opacity: 0.9 });
    JOINT_DEFS.forEach((jd) => {
      const part = parts.get(jd.followPartId);
      if (!part) return;
      const local = jd.position.clone().sub(part.def.center);
      const ring = new THREE.Mesh(jointGeo, jointMat);
      ring.position.copy(local);
      const dot = new THREE.Mesh(jointDotGeo, jointMat);
      dot.position.copy(local);
      part.group.add(ring, dot);
    });

    const eyeGeo = new THREE.SphereGeometry(0.014, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xe6f9ff });
    const jaw = parts.get("head_jaw");
    if (jaw) {
      EYE_DEFS.forEach((ep) => {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.copy(ep.clone().sub(jaw.def.center));
        jaw.group.add(eye);
      });
    }

    const chest = parts.get("chest");
    let reactorLight: THREE.PointLight | null = null;
    if (chest) {
      const reactorLocal = new THREE.Vector3(0, 0, chest.def.half.z + 0.015);
      const reactorMat = new THREE.MeshBasicMaterial({ color: REACTOR_HEX });
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 12), reactorMat);
      core.position.copy(reactorLocal);
      const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 8, 24), reactorMat);
      ring1.position.copy(reactorLocal);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.005, 8, 24), reactorMat);
      ring2.position.copy(reactorLocal);
      chest.group.add(core, ring1, ring2);
      reactorLight = new THREE.PointLight(REACTOR_HEX, 0.35, 1.1, 2);
      reactorLight.position.copy(reactorLocal);
      chest.group.add(reactorLight);
    }

    // Faint callout tethers from each part's rest position to its current
    // (possibly exploded) position — root-space, one shared buffer.
    const tetherPositions = new Float32Array(PART_DEFS.length * 2 * 3);
    const tetherGeo = new THREE.BufferGeometry();
    tetherGeo.setAttribute("position", new THREE.BufferAttribute(tetherPositions, 3));
    const tetherMat = new THREE.LineBasicMaterial({ color: EDGE_HEX, transparent: true, opacity: 0 });
    const tethers = new THREE.LineSegments(tetherGeo, tetherMat);
    root.add(tethers);

    // Soft ambient halo behind the figure so it reads as one glowing
    // projection rather than a dozen separately-lit panels.
    const haloSize = 128;
    const haloCanvas = document.createElement("canvas");
    haloCanvas.width = haloCanvas.height = haloSize;
    const haloCtx = haloCanvas.getContext("2d");
    if (haloCtx) {
      const g = haloCtx.createRadialGradient(
        haloSize / 2, haloSize / 2, 0, haloSize / 2, haloSize / 2, haloSize / 2
      );
      g.addColorStop(0, "rgba(120,220,255,0.28)");
      g.addColorStop(1, "rgba(120,220,255,0)");
      haloCtx.fillStyle = g;
      haloCtx.fillRect(0, 0, haloSize, haloSize);
    }
    const haloTex = new THREE.CanvasTexture(haloCanvas);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.position.set(0, 0.2, -0.4);
    halo.scale.set(2.7, 2.7, 1);
    scene.add(halo);

    // Bloom so the emissive bits (eyes, reactor, edge lines) actually
    // glow instead of just being a flat bright color.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.4, 0.45);
    composer.addPass(bloom);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    const draw = () => {
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
      root.rotation.x = rotRef.current.x;
      root.rotation.y = rotRef.current.y;

      explodeRef.current += (explodeTargetRef.current - explodeRef.current) * 0.06;
      const explode = explodeRef.current;

      let ti = 0;
      parts.forEach((p) => {
        p.group.position
          .copy(p.def.center)
          .addScaledVector(p.explodeDir, explode * EXPLODE_DIST * p.explodeScale);
        tetherPositions[ti++] = p.def.center.x;
        tetherPositions[ti++] = p.def.center.y;
        tetherPositions[ti++] = p.def.center.z;
        tetherPositions[ti++] = p.group.position.x;
        tetherPositions[ti++] = p.group.position.y;
        tetherPositions[ti++] = p.group.position.z;
      });
      tetherGeo.attributes.position.needsUpdate = true;
      tetherMat.opacity = 0.16 * Math.min(1, explode * 3);

      armorMat.emissiveIntensity = 0.28 + lvl * 0.35;
      if (reactorLight) reactorLight.intensity = (1.0 + lvl * 1.2) * (1 - explode * 0.5);
      bloom.strength = 0.35 + lvl * 0.35;
      root.scale.setScalar(1 + lvl * 0.02);

      composer.render();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      composer.dispose();
      renderer.dispose();
      haloTex.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
        }
      });
      armorMat.dispose();
      edgeMat.dispose();
      jointMat.dispose();
      eyeMat.dispose();
      tetherMat.dispose();
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
