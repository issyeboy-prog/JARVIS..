import { NextRequest, NextResponse } from "next/server";

// Server-side only — the Anthropic key never reaches the browser.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001"; // fast, cheap — good fit for a voice loop

const SYSTEM_PROMPT = `You are JARVIS, a personal voice assistant running on someone's home dashboard.
Keep replies short and conversational (1-3 sentences) since they'll be read aloud by text-to-speech.
Be direct and a little dry-witted, but genuinely helpful. No markdown, no bullet points — plain spoken sentences only.
You may be given a block of live context (current date/time, weather, schedule, news headlines, quote of the day, word of the day). Use it when relevant to answer the question, and don't mention fields that aren't relevant to what was asked. Never invent specifics (times, headlines, temperatures) that aren't in the context provided.
If asked for a "daily briefing" (or similar — a rundown, summary of the day, etc.), give a natural spoken paragraph covering: the date and time, today's schedule, the most pressing news headline, the weather, the quote of the day, and the word of the day — that one response can run longer than the usual 1-3 sentences.`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "assistant-not-configured" },
      { status: 501 }
    );
  }

  const { text, context } = (await request.json()) as {
    text?: string;
    context?: string;
  };
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "missing-text" }, { status: 400 });
  }

  const userMessage = context
    ? `Live context:\n${context}\n\nUser said: ${text}`
    : text;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ASSISTANT_MODEL || DEFAULT_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
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
