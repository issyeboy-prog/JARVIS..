import { NextRequest, NextResponse } from "next/server";

// The real enforcement point: a client-side password screen alone doesn't
// stop someone from just POSTing straight to these routes and burning
// Anthropic/ElevenLabs credits. Only requests carrying the unlock cookie
// (set by /api/gate after a correct password) get through.
const GATE_COOKIE = "jarvis_gate";

export function proxy(request: NextRequest) {
  const unlocked = request.cookies.get(GATE_COOKIE)?.value === "1";
  if (!unlocked) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/assistant/:path*", "/api/tts/:path*", "/api/news/:path*"],
};
