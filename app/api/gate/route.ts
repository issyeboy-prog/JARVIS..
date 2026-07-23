import { NextRequest, NextResponse } from "next/server";

// Kept server-side only, never sent to the client — so the actual phrase
// isn't sitting in the JS bundle for anyone to view-source.
const PASSWORD = "superman sucks";
const GATE_COOKIE = "jarvis_gate";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

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
  response.cookies.set(GATE_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
  });
  return response;
}
