"use client";

import { useState, useSyncExternalStore } from "react";
import {
  readSchedule,
  subscribeSchedule,
  getScheduleServerSnapshot,
  addScheduleEvent,
  removeScheduleEventById,
  updateScheduleEvent,
  type ScheduleEvent,
} from "@/lib/scheduleStore";

function EditRow({ event, onDone }: { event: ScheduleEvent; onDone: () => void }) {
  const [time, setTime] = useState(event.time);
  const [title, setTitle] = useState(event.title);

  const save = () => {
    if (!time || !title.trim()) return;
    updateScheduleEvent(event.id, { time, title: title.trim() });
    onDone();
  };

  return (
    <li className="flex items-center gap-2 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/5 px-3 py-2">
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="w-[6.5rem] shrink-0 rounded-md border border-fuchsia-400/25 bg-black/30 px-1.5 py-1 font-mono text-sm text-fuchsia-100 focus:border-fuchsia-400/60 focus:outline-none"
      />
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        className="min-w-0 flex-1 rounded-md border border-fuchsia-400/25 bg-black/30 px-2 py-1 text-sm text-cyan-50 focus:border-fuchsia-400/60 focus:outline-none"
      />
      <button
        onClick={save}
        aria-label="Save"
        className="shrink-0 rounded-md border border-fuchsia-400/40 bg-fuchsia-500/10 px-2 py-1 text-xs text-fuchsia-200 transition hover:bg-fuchsia-500/20"
      >
        Save
      </button>
      <button
        onClick={onDone}
        aria-label="Cancel"
        className="shrink-0 text-cyan-200/40 hover:text-cyan-200/80"
      >
        ×
      </button>
    </li>
  );
}

export default function SchedulePanel() {
  const events = useSyncExternalStore(
    subscribeSchedule,
    readSchedule,
    getScheduleServerSnapshot
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTime, setNewTime] = useState("09:00");
  const [newTitle, setNewTitle] = useState("");

  const add = () => {
    if (!newTitle.trim()) return;
    addScheduleEvent(newTime, newTitle.trim());
    setNewTitle("");
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="text-xs uppercase tracking-[0.3em] text-cyan-400/70 holo-text">
        Schedule
      </h2>
      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {events.map((e) =>
          editingId === e.id ? (
            <EditRow key={e.id} event={e} onDone={() => setEditingId(null)} />
          ) : (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded-lg border border-cyan-500/10 bg-cyan-500/5 px-3 py-2"
            >
              <span className="font-mono text-sm text-cyan-300">{e.time}</span>
              <span className="flex-1 text-sm text-cyan-50/90">{e.title}</span>
              {/* Always visible (not hover-only) — hover doesn't exist on
                  touch, so a tap-only reveal would make these unreachable
                  on phones/tablets. */}
              <button
                onClick={() => setEditingId(e.id)}
                aria-label="Edit"
                className="shrink-0 rounded-md p-1.5 text-sm text-cyan-200/50 transition hover:bg-fuchsia-500/10 hover:text-fuchsia-300 active:bg-fuchsia-500/20"
              >
                ✎
              </button>
              <button
                onClick={() => removeScheduleEventById(e.id)}
                aria-label="Remove event"
                className="shrink-0 rounded-md p-1.5 text-base leading-none text-cyan-200/50 transition hover:bg-fuchsia-500/10 hover:text-fuchsia-300 active:bg-fuchsia-500/20"
              >
                ×
              </button>
            </li>
          )
        )}
        {events.length === 0 && (
          <li className="text-sm text-cyan-200/40">Nothing scheduled.</li>
        )}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex gap-2 border-t border-cyan-500/10 pt-3"
      >
        <input
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          className="w-[6.5rem] shrink-0 rounded-lg border border-cyan-500/15 bg-black/20 px-1.5 py-1.5 font-mono text-sm text-cyan-50 focus:border-fuchsia-400/50 focus:outline-none"
        />
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New event…"
          className="min-w-0 flex-1 rounded-lg border border-cyan-500/15 bg-black/20 px-3 py-1.5 text-sm text-cyan-50 placeholder:text-cyan-200/30 focus:border-fuchsia-400/50 focus:outline-none"
        />
        <button
          type="submit"
          className="neon-action shrink-0 rounded-lg border px-3 text-sm transition"
        >
          Add
        </button>
      </form>
    </div>
  );
}
