import { NextRequest, NextResponse } from "next/server";

// Keeps the ElevenLabs API key server-side only — it must never reach the
// browser bundle or be visible in devtools network requests.
const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // "Adam" stock voice

export async function POST(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "elevenlabs-not-configured" },
      { status: 501 }
    );
  }

  const { text } = (await request.json()) as { text?: string };
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "missing-text" }, { status: 400 });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
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
