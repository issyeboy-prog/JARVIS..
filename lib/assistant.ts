"use client";

// Falls back to a few canned responses if no ANTHROPIC_API_KEY is
// configured yet, or the request fails for any reason — so voice control
// still works end-to-end before the real brain is wired up.
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

export async function askAssistant(text: string): Promise<string> {
  try {
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const data = (await res.json()) as { reply: string };
      return data.reply;
    }
  } catch {
    // network error — fall through to the canned response below
  }
  return cannedResponse(text);
}
