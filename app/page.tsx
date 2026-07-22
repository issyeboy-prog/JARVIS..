"use client";

import Nebula from "@/components/Nebula";
import Clock from "@/components/Clock";
import SchedulePanel from "@/components/SchedulePanel";
import WeatherPanel from "@/components/WeatherPanel";
import NotificationsPanel from "@/components/NotificationsPanel";
import SystemStatusPanel from "@/components/SystemStatusPanel";
import NotesPanel from "@/components/NotesPanel";
import NewsPanel from "@/components/NewsPanel";
import VoiceControl from "@/components/VoiceControl";
import { useVoice } from "@/contexts/VoiceContext";

export default function Home() {
  const { level, status } = useVoice();

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-1 pb-4 text-[11px] uppercase tracking-[0.4em] text-cyan-400/50">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
          Jarvis Online
        </span>
        <span suppressHydrationWarning>
          {new Date().toLocaleDateString([], {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>

      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[280px_1fr_280px] lg:grid-rows-[auto_auto_auto]">
        <div className="glass-panel holo-panel lg:col-start-1 lg:row-start-1" style={{ "--holo-delay": "0s" } as React.CSSProperties}>
          <Clock />
        </div>
        <div className="glass-panel holo-panel lg:col-start-3 lg:row-start-1" style={{ "--holo-delay": "1s" } as React.CSSProperties}>
          <WeatherPanel />
        </div>

        <div className="relative order-first min-h-[420px] lg:order-none lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <Nebula level={level} status={status} />
        </div>

        <div className="glass-panel holo-panel lg:col-start-1 lg:row-start-2" style={{ "--holo-delay": "2s" } as React.CSSProperties}>
          <SchedulePanel />
        </div>
        <div className="glass-panel holo-panel lg:col-start-3 lg:row-start-2" style={{ "--holo-delay": "3s" } as React.CSSProperties}>
          <NotificationsPanel />
        </div>

        <div className="glass-panel holo-panel lg:col-start-1 lg:row-start-3" style={{ "--holo-delay": "4s" } as React.CSSProperties}>
          <NotesPanel />
        </div>
        <div className="glass-panel holo-panel lg:col-start-3 lg:row-start-3" style={{ "--holo-delay": "5s" } as React.CSSProperties}>
          <SystemStatusPanel />
        </div>

        <div className="glass-panel holo-panel min-h-[220px] lg:col-span-3" style={{ "--holo-delay": "6s" } as React.CSSProperties}>
          <NewsPanel />
        </div>

        <div className="glass-panel holo-panel lg:col-span-3">
          <VoiceControl />
        </div>
      </div>
    </div>
  );
}
