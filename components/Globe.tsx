"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { useVoice, type VoiceStatus } from "@/contexts/VoiceContext";
import {
  startHandGestures,
  type HandGestureHandle,
  type HandPoint,
} from "@/lib/handGestures";

// --- Holographic Earth -----------------------------------------------------
//
// A glass/wireframe globe with hand-authored continent outlines (rough but
// recognizable equirectangular polygons, not a licensed dataset or texture)
// draped over its surface. Each continent is its own Object3D, built by
// triangulating its outline flat (via THREE.Shape/ShapeGeometry, in lon/lat
// space) and then remapping every vertex onto the sphere — so a peace sign
// can lift each landmass off the globe along its own outward normal, and a
// fist pulls them back down, the same explode/reassemble rig used before.

function latLonToVector3(lat: number, lon: number, radius: number, out: THREE.Vector3): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  out.x = -radius * Math.sin(phi) * Math.cos(theta);
  out.y = radius * Math.cos(phi);
  out.z = radius * Math.sin(phi) * Math.sin(theta);
  return out;
}

// Rough, hand-drawn [lon, lat] outlines — recognizable silhouettes, not
// surveyed coastlines.
const NORTH_AMERICA = [
  [-165, 65], [-140, 70], [-95, 75], [-75, 70], [-60, 50], [-52, 47],
  [-65, 45], [-80, 25], [-97, 18], [-105, 20], [-115, 30], [-124, 40],
  [-125, 49], [-140, 60],
];
const SOUTH_AMERICA = [
  [-77, 10], [-60, 10], [-50, 0], [-35, -5], [-38, -15], [-40, -23],
  [-48, -25], [-58, -34], [-68, -52], [-72, -45], [-70, -30], [-75, -15],
  [-81, -4],
];
const AFRICA = [
  [-17, 15], [-16, 21], [-10, 30], [0, 37], [10, 37], [20, 33], [32, 31],
  [35, 27], [43, 12], [51, 12], [49, -1], [40, -15], [35, -25], [30, -30],
  [20, -35], [15, -27], [12, -18], [13, -5], [8, 4], [-5, 5], [-10, 10],
];
const EUROPE = [
  [-9, 38], [-8, 43], [-1, 43], [3, 43], [7, 44], [12, 42], [15, 38],
  [20, 40], [27, 41], [30, 45], [28, 54], [30, 60], [20, 65], [10, 63],
  [5, 58], [-5, 50], [-10, 44],
];
const ASIA = [
  [30, 45], [40, 42], [48, 40], [55, 25], [60, 25], [65, 25], [70, 20],
  [78, 8], [80, 15], [90, 22], [95, 20], [100, 10], [103, 1], [105, 10],
  [110, 20], [120, 25], [122, 31], [120, 36], [130, 38], [140, 45],
  [160, 60], [170, 65], [150, 70], [120, 75], [100, 78], [80, 73],
  [60, 70], [50, 68], [40, 66], [35, 55],
];
const AUSTRALIA = [
  [113, -22], [122, -18], [130, -12], [136, -12], [142, -11], [145, -16],
  [148, -20], [153, -27], [153, -32], [150, -37], [140, -38], [132, -32],
  [126, -32], [115, -34],
];

const CONTINENTS: { id: string; name: string; points: number[][] }[] = [
  { id: "north_america", name: "North America", points: NORTH_AMERICA },
  { id: "south_america", name: "South America", points: SOUTH_AMERICA },
  { id: "africa", name: "Africa", points: AFRICA },
  { id: "europe", name: "Europe", points: EUROPE },
  { id: "asia", name: "Asia", points: ASIA },
  { id: "australia", name: "Australia", points: AUSTRALIA },
];

// Ear-clipping a concave coastline (every real one) sometimes needs a
// triangle whose edge is a long diagonal cutting across the polygon — fine
// in flat 2D, but that diagonal's endpoints can be many degrees of lon/lat
// apart. Projected straight onto the sphere as a single flat triangle, a
// span that wide reads as a wild spike instead of a coastline. Subdividing
// each triangle (in flat lon/lat space, where it's cheap and exact) before
// projecting keeps every triangle's angular span small, so the sphere
// projection stays smooth.
function subdivideFlat(positions: ArrayLike<number>, times: number): Float32Array {
  let pos: ArrayLike<number> = positions;
  for (let t = 0; t < times; t++) {
    const triCount = pos.length / 9;
    const out = new Float32Array(triCount * 4 * 9);
    let o = 0;
    const mid = (i: number, j: number, arr: ArrayLike<number>) => [
      (arr[i] + arr[j]) / 2,
      (arr[i + 1] + arr[j + 1]) / 2,
      (arr[i + 2] + arr[j + 2]) / 2,
    ];
    for (let i = 0; i < triCount; i++) {
      const b = i * 9;
      const A = [pos[b], pos[b + 1], pos[b + 2]];
      const B = [pos[b + 3], pos[b + 4], pos[b + 5]];
      const C = [pos[b + 6], pos[b + 7], pos[b + 8]];
      const AB = mid(b, b + 3, pos);
      const BC = mid(b + 3, b + 6, pos);
      const CA = mid(b + 6, b, pos);
      const tris = [
        [A, AB, CA],
        [B, BC, AB],
        [C, CA, BC],
        [AB, BC, CA],
      ];
      tris.forEach(([p1, p2, p3]) => {
        out[o++] = p1[0]; out[o++] = p1[1]; out[o++] = p1[2];
        out[o++] = p2[0]; out[o++] = p2[1]; out[o++] = p2[2];
        out[o++] = p3[0]; out[o++] = p3[1]; out[o++] = p3[2];
      });
    }
    pos = out;
  }
  return pos as Float32Array;
}

function buildContinentGeometry(points: number[][], radius: number) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const flat = new THREE.ShapeGeometry(shape).toNonIndexed();
  const subdivided = subdivideFlat(flat.attributes.position.array, 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(subdivided, 3));

  const centroid = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  points.forEach(([lon, lat]) => centroid.add(latLonToVector3(lat, lon, 1, tmp)));
  centroid.divideScalar(points.length).normalize();
  const restPosition = centroid.clone().multiplyScalar(radius);

  // Vertices come out as (lon, lat, 0) — reproject each onto the sphere,
  // then re-center on the continent's own rest position so the geometry
  // (like the old armor panels) lives in local, origin-relative space and
  // the group's own transform drives the explode offset.
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    latLonToVector3(pos.getY(i), pos.getX(i), radius, v).sub(restPosition);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // The coastline outline is built from the original boundary points, not
  // the subdivided fill — an EdgesGeometry on the fill would trace every
  // internal triangulation seam, not just the coast. Each edge is linearly
  // interpolated in lon/lat before projecting, for a smooth curved line
  // instead of one long chord per original point.
  const outlineVerts: number[] = [];
  const segs = 6;
  const ov = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const [lon1, lat1] = points[i];
    const [lon2, lat2] = points[(i + 1) % points.length];
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      latLonToVector3(lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t, radius, ov).sub(restPosition);
      outlineVerts.push(ov.x, ov.y, ov.z);
    }
  }
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(outlineVerts), 3));

  return { geo, edgeGeo, restPosition, explodeDir: centroid.clone() };
}

function hash(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const EARTH_RADIUS = 1.0;
const EXPLODE_DIST = 0.8;
// Realistic-Earth palette (blue ocean, green land, white cloud/light) rather
// than the app's usual cyan/magenta duotone — the ring and rim glow below
// keep a magenta HUD accent, but the planet itself should read as a planet.
const OCEAN_HEX = 0x1c7dff;
const LAND_HEX = 0x39ff6a;
const LAND_EDGE_HEX = 0xb6ffce;
const ATMO_HEX = 0x4fb2ff;
const RING_HEX = 0xff2bd6;

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
  const labelLayerRef = useRef<HTMLDivElement>(null);
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
  // 0 = assembled globe, 1 = continents fully lifted off the surface.
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
        // Peace sign: lift every continent off the globe's surface, like
        // examining an exploded diagram of the planet.
        onPeaceSign: () => {
          explodeTargetRef.current = 1;
        },
        // Closed fist: settle every continent back onto the globe.
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
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0, 4.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);

    // Warm near-white "sunlight" key + a deep-blue fill on the far side —
    // reads as an actual lit planet instead of flat cyberpunk two-tone.
    scene.add(new THREE.HemisphereLight(0xdbefff, 0x0a0f1a, 0.55));
    const key = new THREE.DirectionalLight(0xfff6e8, 0.9);
    key.position.set(1.6, 2.2, 2.4);
    scene.add(key);
    const rimLight = new THREE.PointLight(0x2a6bff, 1.1, 8, 2);
    rimLight.position.set(-1.8, 0.6, -1.6);
    scene.add(rimLight);

    const root = new THREE.Group();
    scene.add(root);

    const oceanMat = new THREE.MeshPhysicalMaterial({
      color: 0x04255c,
      emissive: OCEAN_HEX,
      emissiveIntensity: 0.28,
      metalness: 0.15,
      roughness: 0.3,
      transparent: true,
      opacity: 0.4,
      transmission: 0.35,
      thickness: 0.6,
      clearcoat: 0.3,
      side: THREE.DoubleSide,
    });
    const ocean = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 48, 32), oceanMat);
    root.add(ocean);

    // A low-poly sphere's EdgesGeometry naturally reads as a lat/lon grid.
    const gridMat = new THREE.LineBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.4 });
    const grid = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.SphereGeometry(EARTH_RADIUS * 1.002, 18, 12)),
      gridMat
    );
    root.add(grid);

    // Sparse, randomly-scattered cloud wisps — a canvas noise texture, not a
    // real cloud dataset, so no lon/lat alignment is needed (real clouds
    // don't align with land anyway).
    const cloudCanvas = document.createElement("canvas");
    cloudCanvas.width = 256;
    cloudCanvas.height = 128;
    const cloudCtx = cloudCanvas.getContext("2d");
    if (cloudCtx) {
      let seed = 42;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let i = 0; i < 70; i++) {
        const x = rand() * cloudCanvas.width;
        const y = rand() * cloudCanvas.height;
        const r = 8 + rand() * 22;
        const g = cloudCtx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,0.55)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        cloudCtx.fillStyle = g;
        cloudCtx.beginPath();
        cloudCtx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
        cloudCtx.fill();
      }
    }
    const cloudTex = new THREE.CanvasTexture(cloudCanvas);
    const cloudMat = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS * 1.03, 32, 24), cloudMat);
    root.add(cloud);

    const landMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a3d1a,
      emissive: LAND_HEX,
      emissiveIntensity: 0.55,
      metalness: 0.1,
      roughness: 0.4,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    const landEdgeMat = new THREE.LineBasicMaterial({
      color: LAND_EDGE_HEX,
      transparent: true,
      opacity: 0.9,
    });

    interface ContinentHandle {
      id: string;
      group: THREE.Group;
      restPosition: THREE.Vector3;
      explodeDir: THREE.Vector3;
      explodeScale: number;
    }
    const continents: ContinentHandle[] = [];

    // Name + news-blurb labels are plain DOM, not WebGL — projected onto
    // screen space every frame from each continent's current (possibly
    // exploded) world position, so they travel with the explode animation
    // for free instead of needing their own tween.
    interface LabelHandle {
      root: HTMLDivElement;
      news: HTMLDivElement;
    }
    const labelLayer = labelLayerRef.current;
    const labelEls = new Map<string, LabelHandle>();

    CONTINENTS.forEach((c, i) => {
      const { geo, edgeGeo, restPosition, explodeDir } = buildContinentGeometry(c.points, EARTH_RADIUS * 1.006);
      const mesh = new THREE.Mesh(geo, landMat);
      const edges = new THREE.LineLoop(edgeGeo, landEdgeMat);
      const group = new THREE.Group();
      group.position.copy(restPosition);
      group.add(mesh, edges);
      root.add(group);
      continents.push({ id: c.id, group, restPosition, explodeDir, explodeScale: 0.85 + hash(i + 900) * 0.3 });

      if (labelLayer) {
        const labelRoot = document.createElement("div");
        labelRoot.style.cssText =
          "position:absolute; left:0; top:0; opacity:0; text-align:center; will-change:transform,opacity;";

        const nameEl = document.createElement("div");
        nameEl.textContent = c.name.toUpperCase();
        nameEl.style.cssText =
          "font:600 10px/1.2 ui-monospace,monospace; letter-spacing:0.15em; color:#eafff2; text-shadow:0 0 6px rgba(57,255,106,0.85),0 1px 3px rgba(0,0,0,0.9); white-space:nowrap; transform:translateX(-50%);";

        const newsEl = document.createElement("div");
        newsEl.textContent = "";
        newsEl.style.cssText =
          "margin-top:4px; width:150px; font:400 9px/1.35 ui-sans-serif,system-ui,sans-serif; color:#dff1ff; text-shadow:0 1px 3px rgba(0,0,0,0.95); transform:translateX(-50%); opacity:0; transition:opacity 0.4s;";

        labelRoot.appendChild(nameEl);
        labelRoot.appendChild(newsEl);
        labelLayer.appendChild(labelRoot);
        labelEls.set(c.id, { root: labelRoot, news: newsEl });
      }
    });

    fetch("/api/news")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { continents?: Record<string, { title: string }[]> } | null) => {
        labelEls.forEach((el, id) => {
          const headline = data?.continents?.[id]?.[0]?.title;
          el.news.textContent = headline ?? "Headlines unavailable.";
        });
      })
      .catch(() => {
        labelEls.forEach((el) => {
          el.news.textContent = "Headlines unavailable.";
        });
      });

    // Faint callout tethers from each continent's rest position to its
    // current (possibly lifted) position — root-space, one shared buffer.
    const tetherPositions = new Float32Array(CONTINENTS.length * 2 * 3);
    const tetherGeo = new THREE.BufferGeometry();
    tetherGeo.setAttribute("position", new THREE.BufferAttribute(tetherPositions, 3));
    const tetherMat = new THREE.LineBasicMaterial({ color: LAND_EDGE_HEX, transparent: true, opacity: 0 });
    const tethers = new THREE.LineSegments(tetherGeo, tetherMat);
    root.add(tethers);

    // Outer atmosphere shell — a backside-rendered sphere with additive
    // blending gives a cheap fresnel-style glow at the rim.
    const atmoMat = new THREE.MeshBasicMaterial({
      color: ATMO_HEX,
      transparent: true,
      opacity: 0.1,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS * 1.18, 32, 24), atmoMat);
    root.add(atmosphere);

    // Slow, independently-spinning targeting ring — a classic sci-fi HUD
    // touch, decoupled from the hand-driven rotation. Kept magenta as the
    // one deliberate cyberpunk accent against an otherwise realistic planet.
    const ringMat = new THREE.MeshBasicMaterial({
      color: RING_HEX,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(EARTH_RADIUS * 1.35, 0.007, 8, 64), ringMat);
    ring.rotation.x = Math.PI / 2 + 0.2;
    scene.add(ring);

    // Molten core glow, visible through the translucent ocean shell —
    // pulses with mic/TTS level like the old arc-reactor did.
    const coreLight = new THREE.PointLight(0xfff2d0, 0.6, 3, 2);
    root.add(coreLight);

    // Soft ambient halo so the globe reads as one glowing projection.
    const haloSize = 128;
    const haloCanvas = document.createElement("canvas");
    haloCanvas.width = haloCanvas.height = haloSize;
    const haloCtx = haloCanvas.getContext("2d");
    if (haloCtx) {
      const g = haloCtx.createRadialGradient(
        haloSize / 2, haloSize / 2, 0, haloSize / 2, haloSize / 2, haloSize / 2
      );
      g.addColorStop(0, "rgba(210,238,255,0.35)");
      g.addColorStop(0.55, "rgba(70,160,255,0.18)");
      g.addColorStop(1, "rgba(70,160,255,0)");
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
    halo.position.set(0, 0, -0.4);
    halo.scale.set(2.9, 2.9, 1);
    scene.add(halo);

    // Bloom so the emissive bits (grid lines, landmasses, ring) actually
    // glow instead of just being a flat bright color.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.4, 0.4);
    composer.addPass(bloom);

    let viewW = 1;
    let viewH = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      viewW = w;
      viewH = h;
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

    // Reused scratch vectors for the label projection below — avoids an
    // allocation per continent per frame.
    const labelWorldPos = new THREE.Vector3();
    const labelWorldNormal = new THREE.Vector3();
    const labelCamToPoint = new THREE.Vector3();

    let raf = 0;
    const draw = () => {
      const lvl = levelRef.current;

      // Slow constant drift so it's never fully static, plus whatever the
      // hand is driving.
      targetRotRef.current.y += 0.0012;

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
      root.updateMatrixWorld();

      explodeRef.current += (explodeTargetRef.current - explodeRef.current) * 0.06;
      const explode = explodeRef.current;

      let ti = 0;
      continents.forEach((c) => {
        c.group.position
          .copy(c.restPosition)
          .addScaledVector(c.explodeDir, explode * EXPLODE_DIST * c.explodeScale);
        tetherPositions[ti++] = c.restPosition.x;
        tetherPositions[ti++] = c.restPosition.y;
        tetherPositions[ti++] = c.restPosition.z;
        tetherPositions[ti++] = c.group.position.x;
        tetherPositions[ti++] = c.group.position.y;
        tetherPositions[ti++] = c.group.position.z;

        // Project this continent's current (possibly exploded) position to
        // screen space and drive the DOM label there directly — no React
        // re-render, same as everything else in this loop. Fades out near
        // the terminator (the continent's own outward normal, rotated into
        // world space, pointing away from the camera) instead of a hard cut.
        const label = labelEls.get(c.id);
        if (label) {
          labelWorldPos.copy(c.group.position);
          root.localToWorld(labelWorldPos);
          labelWorldNormal.copy(c.explodeDir).applyQuaternion(root.quaternion);
          labelCamToPoint.copy(camera.position).sub(labelWorldPos).normalize();
          const facing = labelWorldNormal.dot(labelCamToPoint);

          // .project() mutates in place, converting world coords to NDC
          // (-1..1) plus a depth value — do this after computing `facing`
          // above, which needed the real world position.
          labelWorldPos.project(camera);
          const screenX = (labelWorldPos.x * 0.5 + 0.5) * viewW;
          const screenY = (-labelWorldPos.y * 0.5 + 0.5) * viewH;

          const fade = THREE.MathUtils.clamp(facing * 3 + 0.3, 0, 1);
          const visible = labelWorldPos.z < 1 && fade > 0.02;
          label.root.style.transform = `translate(${screenX}px, ${screenY + 16}px)`;
          label.root.style.opacity = visible ? String(fade) : "0";
          label.news.style.opacity = String(
            THREE.MathUtils.clamp((explode - 0.35) * 4, 0, 1) * fade
          );
        }
      });
      tetherGeo.attributes.position.needsUpdate = true;
      tetherMat.opacity = 0.2 * Math.min(1, explode * 3);

      oceanMat.emissiveIntensity = 0.2 + lvl * 0.3;
      landMat.emissiveIntensity = 0.5 + lvl * 0.35;
      coreLight.intensity = (0.5 + lvl * 1.1) * (1 - explode * 0.3);
      bloom.strength = 0.4 + lvl * 0.35;
      ring.rotation.z += 0.0025;
      cloud.rotation.y += 0.0007;
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
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose();
        }
      });
      oceanMat.dispose();
      gridMat.dispose();
      cloudTex.dispose();
      cloudMat.dispose();
      landMat.dispose();
      landEdgeMat.dispose();
      atmoMat.dispose();
      ringMat.dispose();
      tetherMat.dispose();
      labelEls.forEach((el) => el.root.remove());
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
      <div ref={labelLayerRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" />
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
      <div
        className={`absolute top-[30%] left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-[0.3em] holo-text ${
          status === "listening" ? "pulse-capturing text-fuchsia-300" : "text-cyan-300/70"
        }`}
      >
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
        className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-fuchsia-400/30 bg-black/30 px-4 py-1.5 text-[11px] uppercase tracking-widest text-cyan-200/80 backdrop-blur transition hover:bg-fuchsia-500/10 disabled:opacity-50"
      >
        {handLabel[handStatus]}
      </button>
    </div>
  );
}
