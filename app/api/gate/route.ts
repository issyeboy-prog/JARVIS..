import { NextRequest, NextResponse } from "next/server";

// Kept server-side only, never sent to the client — so the actual phrase
// isn't sitting in the JS bundle for anyone to view-source.
const PASSWORD = "superman sucks";
const GATE_COOKIE = "jarvis_gate";

// Loose match: strips punctuation and collapses whitespace/case so speech
// recognition quirks ("Superman sucks." vs "superman, sucks") still pass.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { phrase?: string } | null;
  const phrase = body?.phrase ?? "";

  if (normalize(phrase) !== normalize(PASSWORD)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  // No maxAge — a session cookie, cleared when the browser fully closes.
  // The UI (PasswordGate) already re-locks on every page load regardless;
  // this keeps the server-side enforcement honest about the same "every
  // reopen" boundary rather than quietly outliving it.
  response.cookies.set(GATE_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}
