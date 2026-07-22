import { NextRequest, NextResponse } from "next/server";

// Server-side only — the Anthropic key never reaches the browser.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001"; // fast, cheap — good fit for a voice loop

const SYSTEM_PROMPT = `You are JARVIS, a personal voice assistant running on someone's home dashboard.
Keep replies short and conversational (1-3 sentences) since they'll be read aloud by text-to-speech.
Be direct and a little dry-witted, but genuinely helpful. No markdown, no bullet points — plain spoken sentences only.`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "assistant-not-configured" },
      { status: 501 }
    );
  }

  const { text } = (await request.json()) as { text?: string };
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "missing-text" }, { status: 400 });
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ASSISTANT_MODEL || DEFAULT_MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "assistant-request-failed", detail },
      { status: 502 }
    );
  }

  const data = (await upstream.json()) as {
    content: { type: string; text?: string }[];
  };
  const reply = data.content.find((b) => b.type === "text")?.text?.trim();

  if (!reply) {
    return NextResponse.json({ error: "empty-reply" }, { status: 502 });
  }

  return NextResponse.json({ reply });
}
