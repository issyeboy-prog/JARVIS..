"use client";

import { useSyncExternalStore } from "react";
import {
  readSchedule,
  subscribeSchedule,
  getScheduleServerSnapshot,
} from "@/lib/scheduleStore";

export default function SchedulePanel() {
  const events = useSyncExternalStore(
    subscribeSchedule,
    readSchedule,
    getScheduleServerSnapshot
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="text-xs uppercase tracking-[0.3em] text-cyan-400/70 holo-text">
        Schedule
      </h2>
      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {events.map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-3 rounded-lg border border-cyan-500/10 bg-cyan-500/5 px-3 py-2"
          >
            <span className="font-mono text-sm text-cyan-300">{e.time}</span>
            <span className="text-sm text-cyan-50/90">{e.title}</span>
          </li>
        ))}
        {events.length === 0 && (
          <li className="text-sm text-cyan-200/40">Nothing scheduled.</li>
        )}
      </ul>
    </div>
  );
}
