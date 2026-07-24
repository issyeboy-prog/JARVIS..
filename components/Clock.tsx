"use client";

import { useEffect, useState } from "react";

function greeting(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Clock() {
  // Lazy initializer — computed once on the client, avoids an extra
  // render-triggering setState call inside an effect.
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-xs uppercase tracking-[0.3em] text-cyan-400/70 holo-text"
        suppressHydrationWarning
      >
        {greeting(now.getHours())}
      </span>
      <span
        className="neon-value font-mono text-4xl font-light tabular-nums text-cyan-50 sm:text-5xl"
        suppressHydrationWarning
      >
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
      <span
        className="text-sm text-cyan-200/60"
        suppressHydrationWarning
      >
        {now.toLocaleDateString([], {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </span>
    </div>
  );
}
