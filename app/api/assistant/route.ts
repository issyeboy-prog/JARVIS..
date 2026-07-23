import { NextRequest, NextResponse } from "next/server";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";

// Claude via Amazon Bedrock (AWS-billed) rather than a direct Anthropic key
// — see AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION below.
//
// Using the plain AnthropicBedrock client (the standard bedrock-runtime
// InvokeModel path), not AnthropicBedrockMantle — Mantle is a separate,
// Anthropic-operated Bedrock endpoint with its own bare-alias model
// naming ("anthropic.claude-haiku-4-5"), which 403'd as not available for
// this account. This account's actual granted access shows up through
// standard Bedrock — confirmed via `aws bedrock list-inference-profiles`
// — as this exact cross-region inference profile ID, so the client needs
// to be the one that speaks that API.
const DEFAULT_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const SYSTEM_PROMPT = `You are JARVIS, a personal voice assistant running on someone's home dashboard.
Keep replies short and conversational (1-3 sentences) since they'll be read aloud by text-to-speech.
Be direct and a little dry-witted, but genuinely helpful. No markdown, no bullet points — plain spoken sentences only.
You may be given a block of live context (current date/time, weather, schedule, news headlines, quote of the day, word of the day). Use it when relevant to answer the question, and don't mention fields that aren't relevant to what was asked. Never invent specifics (times, headlines, temperatures) that aren't in the context provided.
If asked for a "daily briefing" (or similar — a rundown, summary of the day, etc.), give a natural spoken paragraph covering: the date and time, today's schedule, the most pressing news headline, the weather, the quote of the day, and the word of the day — that one response can run longer than the usual 1-3 sentences.
When asked to add, remove, cancel, move, or otherwise change something on the schedule/calendar, use the add_schedule_event or remove_schedule_event tools rather than just talking about it — actually make the change, then confirm what you did in one short spoken sentence.`;

// Executed client-side (the schedule lives in the browser's localStorage,
// not on this server), so these are just the schemas Claude reasons about.
const TOOLS: Anthropic.Tool[] = [
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

// Credentials resolve from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (the
// standard AWS SDK env var names) automatically — only the region needs to
// be passed explicitly here. One client instance is reused across requests
// rather than rebuilt per call.
let bedrockClient: AnthropicBedrock | null = null;
function getBedrockClient(): AnthropicBedrock | null {
  if (!process.env.AWS_REGION || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return null;
  }
  if (!bedrockClient) {
    bedrockClient = new AnthropicBedrock({
      awsRegion: process.env.AWS_REGION,
      // Defaults are a 10-minute timeout and 2 retries on 429/5xx/network
      // errors — fine for a batch job, bad for a voice loop: a genuinely
      // broken config (wrong model ID, missing model access, bad IAM
      // permissions) would otherwise burn retry time before ever
      // reaching the client-side fallback, making "misconfigured" look
      // identical to "just slow." One retry, 12s ceiling.
      timeout: 12_000,
      maxRetries: 1,
    });
  }
  return bedrockClient;
}

export async function POST(request: NextRequest) {
  const client = getBedrockClient();
  if (!client) {
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

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: process.env.ASSISTANT_MODEL || DEFAULT_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: messages as Anthropic.MessageParam[],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "assistant-request-failed", detail },
      { status: 502 }
    );
  }

  if (response.stop_reason === "tool_use") {
    const toolCalls = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));

    return NextResponse.json({
      toolCalls,
      // The client appends a tool_result user turn to this and re-posts
      // it here to get the final natural-language confirmation.
      messages: [...messages, { role: "assistant", content: response.content }],
    });
  }

  const reply = response.content
    .find((b): b is Anthropic.TextBlock => b.type === "text")
    ?.text?.trim();
  if (!reply) {
    return NextResponse.json({ error: "empty-reply" }, { status: 502 });
  }

  return NextResponse.json({ reply });
}
