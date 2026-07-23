"use client";

import {
  addScheduleEvent,
  removeScheduleEventsByQuery,
} from "./scheduleStore";

// Falls back to a few canned responses if the Bedrock-backed route isn't
// configured yet, or the request fails for any reason — so voice control
// still works end-to-end before the real brain is wired up. Previously
// this fallback was completely silent (any failure just quietly returned
// "I heard: X" with zero trace of why) — that's exactly what made a
// broken assistant call indistinguishable from a working-but-dumb one.
// AssistantEngineReport (below) exists so the caller can surface the real
// reason instead.
function cannedResponse(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("time")) {
    return `It's ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  }
  if (t.includes("hello") || t.includes("hi ")) {
    return "Hello. I'm listening.";
  }
  return `I heard: ${text}`;
}

export type AssistantEngineReport =
  | { engine: "bedrock" }
  | { engine: "fallback"; reason: string };

export interface AskAssistantResult {
  reply: string;
  report: AssistantEngineReport;
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AssistantResponse {
  reply?: string;
  toolCalls?: ToolCall[];
  messages?: unknown[];
}

// Runs a tool call the model requested. The schedule lives in this
// browser's localStorage, not on the server, so execution has to happen
// here — the API route only knows the tool *schemas*, not the data.
function executeTool(call: ToolCall): string {
  if (call.name === "add_schedule_event") {
    const time = String(call.input.time ?? "").trim();
    const title = String(call.input.title ?? "").trim();
    if (!time || !title) return "Missing a time or title — couldn't add it.";
    addScheduleEvent(time, title);
    return `Added "${title}" at ${time}.`;
  }
  if (call.name === "remove_schedule_event") {
    const query = String(call.input.query ?? "").trim();
    if (!query) return "No search text given — couldn't remove anything.";
    const removed = removeScheduleEventsByQuery(query);
    return removed.length
      ? `Removed: ${removed.map((e) => e.title).join(", ")}.`
      : `Nothing matching "${query}" was found on the schedule.`;
  }
  return `Unknown tool: ${call.name}`;
}

// Reads the JSON error body a failed /api/assistant response, so the
// fallback reason says *what* went wrong (missing config, a Bedrock
// error, a bad HTTP status) instead of just "it didn't work."
async function describeFailure(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string; detail?: string } | null;
  if (!body?.error) return `HTTP ${res.status}`;
  return body.detail ? `${body.error}: ${body.detail}` : `${body.error} (HTTP ${res.status})`;
}

export async function askAssistant(text: string, context?: string): Promise<AskAssistantResult> {
  try {
    let res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, context }),
    });
    if (!res.ok) {
      const reason = await describeFailure(res);
      return { reply: cannedResponse(text), report: { engine: "fallback", reason } };
    }
    let data = (await res.json()) as AssistantResponse;

    // Claude may chain a couple of tool calls (e.g. remove one event, add
    // another) before giving a final spoken reply — capped so a stuck loop
    // can't hang the conversation forever.
    let iterations = 0;
    while (data.toolCalls && data.toolCalls.length > 0 && iterations < 4) {
      iterations++;
      const toolResults = data.toolCalls.map((call) => ({
        type: "tool_result",
        tool_use_id: call.id,
        content: executeTool(call),
      }));

      res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...(data.messages ?? []),
            { role: "user", content: toolResults },
          ],
        }),
      });
      if (!res.ok) {
        const reason = await describeFailure(res);
        return { reply: cannedResponse(text), report: { engine: "fallback", reason } };
      }
      data = (await res.json()) as AssistantResponse;
    }

    if (data.reply) return { reply: data.reply, report: { engine: "bedrock" } };
    return {
      reply: cannedResponse(text),
      report: { engine: "fallback", reason: "empty reply from assistant" },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { reply: cannedResponse(text), report: { engine: "fallback", reason } };
  }
}
