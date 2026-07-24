"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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

// Same projection used everywhere a lon/lat needs a flat 2D coordinate — the
// procedural texture canvas, and every mesh's UV attribute — so the drawn
// continents and the 3D continent pieces always line up exactly.
function lonLatToUV(lon: number, lat: number): [number, number] {
  return [(lon + 180) / 360, (lat + 90) / 180];
}

// The root group's rotation is plain X-then-Y Euler (no Z, no quaternions)
// — this solves that same system in reverse: given a local direction `dir`
// (a continent's fixed, un-rotated outward normal), what (rx, ry) brings
// that exact direction to face the camera at (0,0,+1)? Derived by solving
// Rx(rx) * Ry(ry) * dir = (0,0,1) component-wise; see the exploded
// derivation in the coyote-sign handler below for why this is safe to
// reuse for both "center on nearest" and "step to the next continent."
function computeCenterRotation(dir: THREE.Vector3): { rx: number; ry: number } {
  const ry = Math.atan2(-dir.x, dir.z);
  const rx = Math.atan2(dir.y, Math.sqrt(dir.x * dir.x + dir.z * dir.z));
  return { rx, ry };
}

// Wraps an angle delta into (-π, π] — without this, animating toward a raw
// atan2 target after the globe has drifted through many full rotations
// makes the spring unwind all of those turns instead of taking the short
// way there.
function wrapAngleDelta(delta: number): number {
  const twoPi = Math.PI * 2;
  let d = delta % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d < -Math.PI) d += twoPi;
  return d;
}

function shortestAngleTarget(current: number, rawTarget: number): number {
  return current + wrapAngleDelta(rawTarget - current);
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

// `color` is an accent only (coastline glow, label text, a faint uniform
// rim tint) — the landmass fill itself comes from the procedural earth
// texture below, not a flat color cutout.
const CONTINENTS: { id: string; name: string; color: number; points: number[][] }[] = [
  { id: "north_america", name: "North America", color: 0x39ff6a, points: NORTH_AMERICA },
  { id: "south_america", name: "South America", color: 0xffe93e, points: SOUTH_AMERICA },
  { id: "africa", name: "Africa", color: 0xff8a2e, points: AFRICA },
  { id: "europe", name: "Europe", color: 0x2effc7, points: EUROPE },
  { id: "asia", name: "Asia", color: 0x8a6aff, points: ASIA },
  { id: "australia", name: "Australia", color: 0xff5e5e, points: AUSTRALIA },
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

  // Vertices come out as (lon, lat, 0) — the UV for the shared earth
  // texture is a pure function of that lon/lat, computed before the
  // position gets overwritten below. Then reproject onto the sphere, nudge
  // slightly along the true radial direction for subtle terrain relief,
  // and re-center on the continent's own rest position so the geometry
  // (like the old armor panels) lives in local, origin-relative space and
  // the group's own transform drives the explode offset.
  const pos = geo.attributes.position;
  const uvArr = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const lon = pos.getX(i);
    const lat = pos.getY(i);
    const [u, uvV] = lonLatToUV(lon, lat);
    uvArr[i * 2] = u;
    uvArr[i * 2 + 1] = uvV;

    latLonToVector3(lat, lon, radius, v);
    n.copy(v).normalize();
    v.addScaledVector(n, terrainBump(v) * 0.008);
    v.sub(restPosition);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
  pos.needsUpdate = true;
  // The subdivided fill is non-indexed (each triangle owns unique verts),
  // so computeVertexNormals alone gives flat per-triangle normals. Welding
  // coincident vertices first lets normals average across neighboring
  // triangles for smooth shading instead of a faceted look.
  const welded = mergeVertices(geo, 1e-5);
  welded.computeVertexNormals();

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

  return { geo: welded, edgeGeo, restPosition, explodeDir: centroid.clone() };
}

function hash(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// A handful of overlapping low-frequency sine waves rather than per-vertex
// random noise — continuous and smooth by construction, so nearby vertices
// displace by nearly the same amount. Real terrain reads as rolling relief
// because it's spatially correlated; independent per-vertex randomness at
// this mesh density just reads as static/pockmarking, not hills.
function terrainBump(p: THREE.Vector3): number {
  return (
    (Math.sin(p.x * 3.1 + p.y * 1.7 + 4.2) +
      Math.cos(p.y * 2.3 - p.z * 2.9 + 1.1) +
      Math.sin(p.z * 4.1 + p.x * 1.3 + 2.6)) /
    3
  );
}

// Gentle radial swell over a sphere centered at the origin — genuine
// geometric relief on the ocean shell rather than a perfectly round one.
function addSurfaceBump(geo: THREE.BufferGeometry, amplitude: number) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    v.addScaledVector(n, terrainBump(v) * amplitude);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// A hand-rolled lat/lon grid sphere instead of THREE.SphereGeometry — its
// own internal UV parameterization doesn't line up with lonLatToUV (and by
// extension the continent pieces built from the same formula), which would
// leave the base globe's texture rotated relative to where the landmasses
// actually sit in 3D. Building it from latLonToVector3/lonLatToUV directly
// guarantees the texture and the continent pieces always agree.
function buildLatLonSphereGeometry(radius: number, lonSegs: number, latSegs: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const v = new THREE.Vector3();
  for (let iy = 0; iy <= latSegs; iy++) {
    const lat = 90 - (iy / latSegs) * 180;
    for (let ix = 0; ix <= lonSegs; ix++) {
      const lon = -180 + (ix / lonSegs) * 360;
      latLonToVector3(lat, lon, radius, v);
      positions.push(v.x, v.y, v.z);
      const [u, uvV] = lonLatToUV(lon, lat);
      uvs.push(u, uvV);
    }
  }
  const rowSize = lonSegs + 1;
  for (let iy = 0; iy < latSegs; iy++) {
    for (let ix = 0; ix < lonSegs; ix++) {
      const a = iy * rowSize + ix;
      const b = a + rowSize;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Procedurally painted terrain — mottled greens/tans/browns within each
// continent's real outline, ocean depth variation, and polar ice — a
// genuine textured look instead of a flat color fill per landmass. No
// external texture asset (this sandbox's network policy blocks fetching
// one to verify against), but a real color-varied surface either way.
function buildEarthTexture(): HTMLCanvasElement {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const oceanGrad = ctx.createLinearGradient(0, 0, 0, H);
  oceanGrad.addColorStop(0, "#0a2a5c");
  oceanGrad.addColorStop(0.5, "#0d3d7a");
  oceanGrad.addColorStop(1, "#0a2a5c");
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, W, H);

  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  for (let i = 0; i < 220; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 15 + rand() * 45;
    const shade = rand() > 0.5 ? "rgba(60,150,225,0.10)" : "rgba(5,20,50,0.16)";
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, shade);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const project = (lon: number, lat: number): [number, number] => [
    ((lon + 180) / 360) * W,
    ((90 - lat) / 180) * H,
  ];
  const EARTH_TONES = ["#2e6b34", "#3c8244", "#7a9e3f", "#b79a53", "#8a5a35", "#5f7a3a"];

  CONTINENTS.forEach((c) => {
    ctx.save();
    ctx.beginPath();
    c.points.forEach(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.clip();

    const xs = c.points.map((p) => project(p[0], p[1])[0]);
    const ys = c.points.map((p) => project(p[0], p[1])[1]);
    const minX = Math.min(...xs) - 6;
    const maxX = Math.max(...xs) + 6;
    const minY = Math.min(...ys) - 6;
    const maxY = Math.max(...ys) + 6;

    ctx.fillStyle = EARTH_TONES[1];
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

    // Base mottling — the terrain color patches themselves.
    for (let i = 0; i < 180; i++) {
      const x = minX + rand() * (maxX - minX);
      const y = minY + rand() * (maxY - minY);
      const r = 5 + rand() * 24;
      const tone = EARTH_TONES[Math.floor(rand() * EARTH_TONES.length)];
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `${tone}ff`);
      g.addColorStop(1, `${tone}00`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Darker shadow blotches and lighter highlight blotches — a much wider
    // contrast range than the base mottling alone, so the terrain reads as
    // dramatic relief at a glance instead of one narrow mid-tone band.
    for (let i = 0; i < 70; i++) {
      const x = minX + rand() * (maxX - minX);
      const y = minY + rand() * (maxY - minY);
      const r = 10 + rand() * 34;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(6,14,6,0.4)");
      g.addColorStop(1, "rgba(6,14,6,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 45; i++) {
      const x = minX + rand() * (maxX - minX);
      const y = minY + rand() * (maxY - minY);
      const r = 6 + rand() * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(235,232,190,0.5)");
      g.addColorStop(1, "rgba(235,232,190,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mountain-ridge-like squiggles, thicker and darker for visibility.
    ctx.strokeStyle = "rgba(30,25,18,0.55)";
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 16; i++) {
      let x = minX + rand() * (maxX - minX);
      let y = minY + rand() * (maxY - minY);
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 4 + Math.floor(rand() * 5);
      for (let s = 0; s < segs; s++) {
        x += (rand() - 0.5) * 45;
        y += (rand() - 0.5) * 45;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Warm glowing city-light clusters — bigger and brighter than a flat
    // dot so they actually read at normal viewing scale, not just on a
    // pixel-peep zoom.
    for (let cluster = 0; cluster < 9; cluster++) {
      const cx = minX + rand() * (maxX - minX);
      const cy = minY + rand() * (maxY - minY);
      const count = 5 + Math.floor(rand() * 10);
      for (let i = 0; i < count; i++) {
        const x = cx + (rand() - 0.5) * 22;
        const y = cy + (rand() - 0.5) * 22;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 3.2);
        glow.addColorStop(0, "rgba(255,238,190,1)");
        glow.addColorStop(0.5, "rgba(255,220,150,0.6)");
        glow.addColorStop(1, "rgba(255,220,150,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,250,225,1)";
        ctx.beginPath();
        ctx.arc(x, y, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  });

  const iceTop = ctx.createLinearGradient(0, 0, 0, H * 0.12);
  iceTop.addColorStop(0, "rgba(255,255,255,0.9)");
  iceTop.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = iceTop;
  ctx.fillRect(0, 0, W, H * 0.12);
  const iceBottom = ctx.createLinearGradient(0, H * 0.88, 0, H);
  iceBottom.addColorStop(0, "rgba(255,255,255,0)");
  iceBottom.addColorStop(1, "rgba(255,255,255,0.9)");
  ctx.fillStyle = iceBottom;
  ctx.fillRect(0, H * 0.88, W, H * 0.12);

  return canvas;
}

const EARTH_RADIUS = 1.0;
const EXPLODE_DIST = 0.8;
// Realistic-Earth base palette (blue ocean, white cloud/light) — each
// continent gets its own poppy neon hue (see CONTINENTS below) rather than
// one flat land color, and the ring keeps a magenta HUD accent.
const OCEAN_HEX = 0x1c7dff;
const LAND_EDGE_HEX = 0xb6ffce; // tether/callout line color only now
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
  // Toggled by the "coyote" hand sign — freezes rotation entirely (both the
  // idle auto-drift and hand-drag input) so labels/news hold still to read,
  // in either the assembled or exploded state. Mirrored into state only for
  // the on-screen "locked" indicator; the draw loop reads the ref.
  const rotationLockedRef = useRef(false);
  const [rotationLocked, setRotationLocked] = useState(false);
  // Populated once the WebGL scene builds its continent pieces — read by
  // the coyote-sign/swipe handlers below, which are wired up in a
  // different effect (hand tracking starts independently of the canvas)
  // and so can't just close over the WebGL effect's own local variables.
  const continentsRef = useRef<{ id: string; explodeDir: THREE.Vector3 }[]>([]);

  // Finds whichever continent is nearest the center of the current view
  // (smallest combined angular distance on both axes) and smoothly
  // re-centers on it — the "lock onto the middle one" behavior.
  const centerOnNearestContinent = () => {
    const list = continentsRef.current;
    if (list.length === 0) return;
    let best = list[0];
    let bestDist = Infinity;
    for (const c of list) {
      const { rx, ry } = computeCenterRotation(c.explodeDir);
      const dx = wrapAngleDelta(rx - rotRef.current.x);
      const dy = wrapAngleDelta(ry - rotRef.current.y);
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    const { rx, ry } = computeCenterRotation(best.explodeDir);
    targetRotRef.current.x = shortestAngleTarget(rotRef.current.x, rx);
    targetRotRef.current.y = shortestAngleTarget(rotRef.current.y, ry);
  };

  // Steps to whichever continent is the next one over in yaw, in the given
  // direction, from wherever the view is centered right now — not
  // necessarily from a continent exactly at the middle.
  const stepToAdjacentContinent = (direction: "left" | "right") => {
    const list = continentsRef.current;
    if (list.length === 0) return;
    let best: { id: string; explodeDir: THREE.Vector3 } | null = null;
    let bestDelta = Infinity;
    for (const c of list) {
      const { ry } = computeCenterRotation(c.explodeDir);
      const delta = wrapAngleDelta(ry - rotRef.current.y);
      // Increasing yaw brings a continent that was to the left into
      // center (see the drag-handler comment below for the full sign
      // derivation) — so a positive delta is "to the left" and a negative
      // delta is "to the right" of wherever we're centered now.
      const signed = direction === "right" ? -delta : delta;
      if (signed > 0.001 && signed < bestDelta) {
        bestDelta = signed;
        best = c;
      }
    }
    if (!best) return;
    const { rx, ry } = computeCenterRotation(best.explodeDir);
    targetRotRef.current.x = shortestAngleTarget(rotRef.current.x, rx);
    targetRotRef.current.y = shortestAngleTarget(rotRef.current.y, ry);
  };

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
          if (last && !rotationLockedRef.current) {
            const dx = drive.x - last.x;
            const dy = drive.y - last.y;
            const DRAG_SENSITIVITY = 22;
            // Mirrored, not inverted: dragging your hand right should feel
            // like grabbing the globe's surface and pulling that point
            // toward you (so what's under your hand moves right with it),
            // which means the *rotation* goes the other way — the same
            // reason turning a real globe a with a fingertip on its right
            // side rotates it opposite to how the front-center point moves.
            targetRotRef.current.y -= dx * DRAG_SENSITIVITY;
            targetRotRef.current.x -= dy * DRAG_SENSITIVITY;
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
        // Coyote sign: snap to whichever continent is nearest the middle
        // of the view right now, then freeze rotation there (assembled or
        // exploded) so names/news are readable. Toggled off the same way,
        // which just resumes normal drift/drag with no position change.
        onCoyoteSign: () => {
          const locking = !rotationLockedRef.current;
          if (locking) centerOnNearestContinent();
          rotationLockedRef.current = locking;
          setRotationLocked(locking);
        },
        // Two-finger point + swipe: step to the next continent over in
        // that direction and lock onto it (starting a fresh lock if one
        // wasn't already active) — this is meant as a reading aid, so
        // landing anywhere other than centered-and-still isn't useful.
        onSwipe: (direction) => {
          stepToAdjacentContinent(direction);
          if (!rotationLockedRef.current) {
            rotationLockedRef.current = true;
            setRotationLocked(true);
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

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0, 4.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);

    // Starfield backdrop — scattered points on a large fixed shell far
    // behind the globe, with a very slow independent drift for a subtle
    // sense of depth. Otherwise the space around the globe is just flat
    // black, which is a big part of why the scene reads as bland.
    const STAR_COUNT = 1400;
    const starPositions = new Float32Array(STAR_COUNT * 3);
    const starColors = new Float32Array(STAR_COUNT * 3);
    const starTmp = new THREE.Vector3();
    const starColorPalette = [
      new THREE.Color(0xffffff),
      new THREE.Color(0xcfe8ff),
      new THREE.Color(0xfff2d0),
    ];
    for (let i = 0; i < STAR_COUNT; i++) {
      starTmp
        .set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
        .normalize()
        .multiplyScalar(12 + Math.random() * 12);
      starPositions[i * 3] = starTmp.x;
      starPositions[i * 3 + 1] = starTmp.y;
      starPositions[i * 3 + 2] = starTmp.z;
      const c = starColorPalette[Math.floor(Math.random() * starColorPalette.length)];
      starColors[i * 3] = c.r;
      starColors[i * 3 + 1] = c.g;
      starColors[i * 3 + 2] = c.b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // A second, sparser layer of larger "bright" stars with their own
    // twinkle (opacity pulse) for a bit of visible sparkle motion, not
    // just a static dot field.
    const BRIGHT_STAR_COUNT = 40;
    const brightStarPositions = new Float32Array(BRIGHT_STAR_COUNT * 3);
    for (let i = 0; i < BRIGHT_STAR_COUNT; i++) {
      starTmp
        .set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
        .normalize()
        .multiplyScalar(13 + Math.random() * 10);
      brightStarPositions[i * 3] = starTmp.x;
      brightStarPositions[i * 3 + 1] = starTmp.y;
      brightStarPositions[i * 3 + 2] = starTmp.z;
    }
    const brightStarGeo = new THREE.BufferGeometry();
    brightStarGeo.setAttribute("position", new THREE.BufferAttribute(brightStarPositions, 3));
    const brightStarMat = new THREE.PointsMaterial({
      size: 0.22,
      color: 0xeaf6ff,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const brightStars = new THREE.Points(brightStarGeo, brightStarMat);
    scene.add(brightStars);

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

    // The shared procedural terrain texture — real mottled color detail
    // rather than a flat cutout fill, used as `map` on both the ocean
    // shell and every continent piece below (all built from the same
    // lon/lat projection, so the texture and geometry always line up).
    const earthTex = new THREE.CanvasTexture(buildEarthTexture());
    earthTex.colorSpace = THREE.SRGBColorSpace;

    const oceanMat = new THREE.MeshPhysicalMaterial({
      map: earthTex,
      emissive: OCEAN_HEX,
      emissiveIntensity: 0.12,
      metalness: 0.1,
      roughness: 0.35,
      transparent: true,
      opacity: 0.92,
      transmission: 0.12,
      thickness: 0.6,
      clearcoat: 0.35,
      side: THREE.DoubleSide,
    });
    const oceanGeo = buildLatLonSphereGeometry(EARTH_RADIUS, 96, 64);
    addSurfaceBump(oceanGeo, 0.01);
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
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
      // Natural white/pale-grey tints — real cloud tops, not an
      // iridescent neon deck.
      const CLOUD_TINTS = ["255,255,255", "240,244,250", "225,230,238", "250,248,244"];
      for (let i = 0; i < 55; i++) {
        const x = rand() * cloudCanvas.width;
        const y = rand() * cloudCanvas.height;
        const r = 8 + rand() * 22;
        const tint = CLOUD_TINTS[Math.floor(rand() * CLOUD_TINTS.length)];
        const g = cloudCtx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${tint},0.42)`);
        g.addColorStop(1, `rgba(${tint},0)`);
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

    interface ContinentHandle {
      id: string;
      group: THREE.Group;
      restPosition: THREE.Vector3;
      explodeDir: THREE.Vector3;
      explodeScale: number;
    }
    const continents: ContinentHandle[] = [];
    const landMats: THREE.MeshPhysicalMaterial[] = [];
    const landEdgeMats: THREE.LineBasicMaterial[] = [];

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

      // The neon hue is now just an accent — a faint uniform rim tint on
      // the textured fill, plus the coastline outline/label glow below —
      // not the landmass's actual color anymore.
      const baseColor = new THREE.Color(c.color);
      const landMat = new THREE.MeshPhysicalMaterial({
        map: earthTex,
        emissive: baseColor,
        emissiveIntensity: 0.1,
        metalness: 0.05,
        roughness: 0.45,
        transparent: true,
        opacity: 0.97,
        side: THREE.DoubleSide,
      });
      const landEdgeMat = new THREE.LineBasicMaterial({
        color: baseColor.clone().lerp(new THREE.Color(0xffffff), 0.55),
        transparent: true,
        opacity: 0.9,
      });
      landMats.push(landMat);
      landEdgeMats.push(landEdgeMat);

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

        const accentHex = `#${c.color.toString(16).padStart(6, "0")}`;
        const nameEl = document.createElement("div");
        nameEl.textContent = c.name.toUpperCase();
        nameEl.style.cssText = `font:600 10px/1.2 ui-monospace,monospace; letter-spacing:0.15em; color:#eafff2; text-shadow:0 0 6px ${accentHex}d9,0 1px 3px rgba(0,0,0,0.9); white-space:nowrap; transform:translateX(-50%);`;

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

    continentsRef.current = continents.map((c) => ({ id: c.id, explodeDir: c.explodeDir }));

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

    // Layered atmosphere shells — several nested backside-rendered spheres
    // at increasing radius and decreasing opacity, instead of one flat
    // shell. A single shell has a hard-ish edge; stacking several fakes
    // the smooth exponential falloff of real atmospheric scattering (the
    // thin, soft blue limb glow you see on Earth-from-space photography
    // and in Interstellar's planet shots) without writing a custom shader.
    const ATMO_LAYERS = [
      { scale: 1.1, opacity: 0.16 },
      { scale: 1.16, opacity: 0.1 },
      { scale: 1.24, opacity: 0.06 },
      { scale: 1.34, opacity: 0.03 },
    ];
    const atmoMats: THREE.MeshBasicMaterial[] = ATMO_LAYERS.map((layer) => {
      const mat = new THREE.MeshBasicMaterial({
        color: ATMO_HEX,
        transparent: true,
        opacity: layer.opacity,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const shell = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS * layer.scale, 32, 24), mat);
      root.add(shell);
      return mat;
    });

    // Slow, independently-spinning targeting ring — a classic sci-fi HUD
    // touch, decoupled from the hand-driven rotation. Kept magenta as the
    // one deliberate cyberpunk accent against an otherwise realistic planet.
    const ringMat = new THREE.MeshBasicMaterial({
      color: RING_HEX,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(EARTH_RADIUS * 1.35, 0.007, 8, 64), ringMat);
    ring.rotation.x = Math.PI / 2 + 0.2;
    scene.add(ring);

    // Orbiting satellite markers, each on its own faint orbit-ring trail at
    // a different radius/inclination/speed — the classic "tracking
    // stations around the globe" sci-fi HUD touch.
    interface SatelliteHandle {
      spin: THREE.Group; // rotated each frame — carries only the satellite
      speed: number;
    }
    // Neutral, near-realistic tones (pale white/blue/amber like actual
    // satellite/station running lights) instead of saturated neon — the
    // ring stays the one deliberate accent color, everything else here
    // leans toward "Interstellar," not cyberpunk.
    const SATELLITES: { radius: number; incline: number; speed: number; color: number }[] = [
      { radius: 1.55, incline: 0.5, speed: 0.006, color: 0xdbeeff },
      { radius: 1.72, incline: -0.35, speed: -0.0045, color: 0x8fc4ff },
      { radius: 1.42, incline: 1.1, speed: 0.008, color: 0xffe6b0 },
    ];
    const satelliteMats: THREE.MeshBasicMaterial[] = [];
    const satelliteRingMats: THREE.MeshBasicMaterial[] = [];
    const satellites: SatelliteHandle[] = SATELLITES.map((s) => {
      // pivot only sets the orbit plane's incline, staying fixed — the
      // orbit-ring trail lives here so it doesn't spin with the satellite.
      const pivot = new THREE.Group();
      pivot.rotation.x = s.incline;

      const orbitMat = new THREE.MeshBasicMaterial({
        color: s.color,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
      });
      satelliteRingMats.push(orbitMat);
      const orbit = new THREE.Mesh(
        new THREE.TorusGeometry(EARTH_RADIUS * s.radius, 0.003, 6, 64),
        orbitMat
      );
      pivot.add(orbit);

      // spin is a child of pivot (so it inherits the incline) but gets its
      // own continuous Y rotation each frame — only this carries the
      // satellite, so the ring itself never moves.
      const spin = new THREE.Group();
      pivot.add(spin);

      const satMat = new THREE.MeshBasicMaterial({ color: s.color });
      satelliteMats.push(satMat);
      const sat = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), satMat);
      sat.position.set(EARTH_RADIUS * s.radius, 0, 0);
      const satGlow = new THREE.PointLight(s.color, 0.4, 0.6, 2);
      sat.add(satGlow);
      spin.add(sat);

      scene.add(pivot);
      return { spin, speed: s.speed };
    });

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

    // A small lens-flare-style glow sitting out along the key light's
    // direction, in world space (not rotated with the globe, same as the
    // light itself) — a cheap but very recognizable "sunlit" cinematic
    // cue, rendered on top (depthTest off) like a real flare would be.
    const sunDir = new THREE.Vector3(1.6, 2.2, 2.4).normalize();
    const flareCanvas = document.createElement("canvas");
    flareCanvas.width = flareCanvas.height = 128;
    const flareCtx = flareCanvas.getContext("2d");
    if (flareCtx) {
      const g = flareCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,250,235,1)");
      g.addColorStop(0.25, "rgba(255,240,210,0.65)");
      g.addColorStop(0.6, "rgba(255,220,180,0.12)");
      g.addColorStop(1, "rgba(255,220,180,0)");
      flareCtx.fillStyle = g;
      flareCtx.fillRect(0, 0, 128, 128);
    }
    const flareTex = new THREE.CanvasTexture(flareCanvas);
    const flareMat = new THREE.SpriteMaterial({
      map: flareTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const flare = new THREE.Sprite(flareMat);
    flare.position.copy(sunDir).multiplyScalar(6);
    flare.scale.set(1.1, 1.1, 1);
    scene.add(flare);

    // Bloom, tuned down from the original neon-cyberpunk pass — a
    // restrained glow on genuinely bright/emissive points (the sun glint,
    // city lights, satellites) reads as cinematic; blooming everything
    // reads as a video-game HUD.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.45, 0.55);
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
      // hand is driving — unless the coyote sign has frozen rotation.
      if (!rotationLockedRef.current) {
        targetRotRef.current.y += 0.0012;
      }

      // Spring: rendered rotation chases the target — tightened up from
      // the original "gooey" feel, which read as laggy once hand-drag and
      // the swipe/lock navigation needed to feel immediate.
      const STIFFNESS = 0.055;
      const DAMPING = 0.72;
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

      oceanMat.emissiveIntensity = 0.08 + lvl * 0.15;
      landMats.forEach((m) => (m.emissiveIntensity = 0.1 + lvl * 0.2));
      coreLight.intensity = (0.5 + lvl * 1.1) * (1 - explode * 0.3);
      bloom.strength = 0.28 + lvl * 0.22;
      ring.rotation.z += 0.0025;
      cloud.rotation.y += 0.0007;
      stars.rotation.y += 0.00015;
      brightStars.rotation.y += 0.00015;
      brightStarMat.opacity = 0.6 + Math.sin(performance.now() * 0.0015) * 0.3;
      satellites.forEach((s) => (s.spin.rotation.y += s.speed));
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
      earthTex.dispose();
      flareTex.dispose();
      flareMat.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose();
        }
      });
      oceanMat.dispose();
      gridMat.dispose();
      cloudTex.dispose();
      cloudMat.dispose();
      landMats.forEach((m) => m.dispose());
      landEdgeMats.forEach((m) => m.dispose());
      atmoMats.forEach((m) => m.dispose());
      ringMat.dispose();
      tetherMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      brightStarGeo.dispose();
      brightStarMat.dispose();
      satelliteMats.forEach((m) => m.dispose());
      satelliteRingMats.forEach((m) => m.dispose());
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
      {rotationLocked && (
        <div className="pointer-events-none absolute top-[35%] left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.25em] text-fuchsia-300 pulse-capturing">
          🔒 Rotation Locked
        </div>
      )}
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
