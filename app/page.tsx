"use client";

import Globe from "@/components/Globe";
import Clock from "@/components/Clock";
import SchedulePanel from "@/components/SchedulePanel";
import WeatherPanel from "@/components/WeatherPanel";
import NotificationsPanel from "@/components/NotificationsPanel";
import SystemStatusPanel from "@/components/SystemStatusPanel";
import NotesPanel from "@/components/NotesPanel";
import NewsPanel from "@/components/NewsPanel";
import WaveformPanel from "@/components/WaveformPanel";
import DailyPanel from "@/components/DailyPanel";
import Draggable from "@/components/Draggable";

export default function Home() {
  return (
    <>
      {/* Full-viewport holographic layer, behind everything below. */}
      <Globe />

      <div className="pointer-events-none relative z-10 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-1 pb-4 text-[11px] uppercase tracking-[0.4em] text-cyan-400/50">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            Jarvis Online
          </span>
          <span className="text-fuchsia-400/50" suppressHydrationWarning>
            {new Date().toLocaleDateString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>

        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[280px_1fr_280px] lg:grid-rows-[auto_auto_auto]">
          <Draggable id="clock" className="glass-panel holo-panel lg:col-start-1 lg:row-start-1" style={{ "--holo-delay": "0s" } as React.CSSProperties}>
            <Clock />
          </Draggable>
          <Draggable id="weather" className="glass-panel holo-panel lg:col-start-3 lg:row-start-1" style={{ "--holo-delay": "1s" } as React.CSSProperties}>
            <WeatherPanel />
          </Draggable>

          <Draggable id="schedule" className="glass-panel holo-panel lg:col-start-1 lg:row-start-2" style={{ "--holo-delay": "2s" } as React.CSSProperties}>
            <SchedulePanel />
          </Draggable>
          <Draggable id="notifications" className="glass-panel holo-panel lg:col-start-3 lg:row-start-2" style={{ "--holo-delay": "3s" } as React.CSSProperties}>
            <NotificationsPanel />
          </Draggable>

          <Draggable id="notes" className="glass-panel holo-panel lg:col-start-1 lg:row-start-3" style={{ "--holo-delay": "4s" } as React.CSSProperties}>
            <NotesPanel />
          </Draggable>
          <Draggable id="system" className="glass-panel holo-panel lg:col-start-3 lg:row-start-3" style={{ "--holo-delay": "5s" } as React.CSSProperties}>
            <SystemStatusPanel />
          </Draggable>

          <Draggable id="daily" className="glass-panel holo-panel lg:col-start-1" style={{ "--holo-delay": "6.5s" } as React.CSSProperties}>
            <DailyPanel />
          </Draggable>

          {/* Deliberately not draggable, per request. */}
          <div className="glass-panel holo-panel lg:col-span-3" style={{ "--holo-delay": "6s" } as React.CSSProperties}>
            <WaveformPanel />
          </div>

          <div className="glass-panel holo-panel min-h-[220px] lg:col-span-3" style={{ "--holo-delay": "7s" } as React.CSSProperties}>
            <NewsPanel />
          </div>
        </div>
      </div>
    </>
  );
}
