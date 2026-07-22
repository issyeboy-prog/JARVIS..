import { NextRequest, NextResponse } from "next/server";

// Server-side only — the Anthropic key never reaches the browser.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001"; // fast, cheap — good fit for a voice loop

const SYSTEM_PROMPT = `You are JARVIS, a personal voice assistant running on someone's home dashboard.
Keep replies short and conversational (1-3 sentences) since they'll be read aloud by text-to-speech.
Be direct and a little dry-witted, but genuinely helpful. No markdown, no bullet points — plain spoken sentences only.
You may be given a block of live context (current date/time, weather, schedule, news headlines, quote of the day, word of the day). Use it when relevant to answer the question, and don't mention fields that aren't relevant to what was asked. Never invent specifics (times, headlines, temperatures) that aren't in the context provided.
If asked for a "daily briefing" (or similar — a rundown, summary of the day, etc.), give a natural spoken paragraph covering: the date and time, today's schedule, the most pressing news headline, the weather, the quote of the day, and the word of the day — that one response can run longer than the usual 1-3 sentences.
When asked to add, remove, cancel, move, or otherwise change something on the schedule/calendar, use the add_schedule_event or remove_schedule_event tools rather than just talking about it — actually make the change, then confirm what you did in one short spoken sentence.`;

// Executed client-side (the schedule lives in the browser's localStorage,
// not on this server), so these are just the schemas Claude reasons about.
const TOOLS = [
  {
    name: "add_schedule_event",
    description: "Add a new event to the user's daily schedule.",
    input_schema: {
      type: "object",
      properties: {
        time: {
          type: "string",
          description: "24-hour time for the event, e.g. '14:30'.",
        },
        title: {
          type: "string",
          description: "Short title for the event, e.g. 'Dentist appointment'.",
        },
      },
      required: ["time", "title"],
    },
  },
  {
    name: "remove_schedule_event",
    description:
      "Remove one or more events from the schedule whose title matches a search query (e.g. 'gym', 'design review').",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text to match against existing event titles.",
        },
      },
      required: ["query"],
    },
  },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: unknown;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "assistant-not-configured" },
      { status: 501 }
    );
  }

  const body = (await request.json()) as {
    text?: string;
    context?: string;
    messages?: ChatMessage[];
  };

  let messages: ChatMessage[];
  if (body.messages && body.messages.length > 0) {
    // Follow-up turn after the client executed a tool call.
    messages = body.messages;
  } else {
    if (!body.text || !body.text.trim()) {
      return NextResponse.json({ error: "missing-text" }, { status: 400 });
    }
    const userMessage = body.context
      ? `Live context:\n${body.context}\n\nUser said: ${body.text}`
      : body.text;
    messages = [{ role: "user", content: userMessage }];
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
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
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
    stop_reason: string;
    content: AnthropicContentBlock[];
  };

  if (data.stop_reason === "tool_use") {
    const toolCalls = data.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id!, name: b.name!, input: b.input ?? {} }));

    return NextResponse.json({
      toolCalls,
      // The client appends a tool_result user turn to this and re-posts
      // it here to get the final natural-language confirmation.
      messages: [...messages, { role: "assistant", content: data.content }],
    });
  }

  const reply = data.content.find((b) => b.type === "text")?.text?.trim();
  if (!reply) {
    return NextResponse.json({ error: "empty-reply" }, { status: 502 });
  }

  return NextResponse.json({ reply });
}
