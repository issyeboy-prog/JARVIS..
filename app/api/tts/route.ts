import { NextRequest, NextResponse } from "next/server";

// Keeps the ElevenLabs API key server-side only — it must never reach the
// browser bundle or be visible in devtools network requests.
const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // "Adam" stock voice

// GET (not POST) so the client can point an <audio> element's src straight
// at this URL and let the browser stream + play progressively as bytes
// arrive, instead of fetching the whole file into a blob first — see
// lib/tts.ts. `text` travels as a query param since <audio> can only GET.
export async function GET(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "elevenlabs-not-configured" },
      { status: 501 }
    );
  }

  const text = request.nextUrl.searchParams.get("text");
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "missing-text" }, { status: 400 });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  // The /stream endpoint (vs. the plain synthesis one) starts returning
  // audio bytes as soon as the first chunk is ready rather than waiting
  // for the whole clip — combined with eleven_flash_v2_5 (ElevenLabs'
  // lowest-latency model), this is what actually gets sound out sooner.
  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "elevenlabs-request-failed", detail },
      { status: 502 }
    );
  }

  return new NextResponse(upstream.body, {
    headers: { "Content-Type": "audio/mpeg" },
  });
}
