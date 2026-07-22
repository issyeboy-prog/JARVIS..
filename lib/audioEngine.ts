"use client";

// Single shared AudioContext for the whole app. Browsers require a user
// gesture before an AudioContext can run, so callers should invoke
// resume() from inside a click/tap handler the first time.
let ctx: AudioContext | null = null;
let micStreamPromise: Promise<MediaStream> | null = null;

function getContext(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();
  }
  return ctx;
}

export async function resumeAudio(): Promise<void> {
  const c = getContext();
  if (c.state === "suspended") await c.resume();
}

export function getMicStream(): Promise<MediaStream> {
  if (!micStreamPromise) {
    micStreamPromise = navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  }
  return micStreamPromise;
}

export async function createMicAnalyser(): Promise<AnalyserNode> {
  const c = getContext();
  const stream = await getMicStream();
  const source = c.createMediaStreamSource(stream);
  const analyser = c.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  source.connect(analyser);
  return analyser;
}

// Connects an <audio> element (e.g. TTS playback) into the graph so we can
// read its spectrum for the reactive visual while it still plays out loud.
export function createElementAnalyser(
  audioEl: HTMLAudioElement
): AnalyserNode {
  const c = getContext();
  const source = c.createMediaElementSource(audioEl);
  const analyser = c.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);
  analyser.connect(c.destination);
  return analyser;
}

// Average amplitude in the 0..1 range, cheap to call every animation frame.
export function getLevel(
  analyser: AnalyserNode,
  buffer: Uint8Array<ArrayBuffer>
): number {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = (buffer[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
}
