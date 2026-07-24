"use client";

// localStorage-backed and mutable (unlike quotes/words in dailyContent.ts)
// — JARVIS can add or remove events via voice, and both SchedulePanel and
// the briefing context need to see those changes immediately.

export interface ScheduleEvent {
  id: string;
  time: string;
  title: string;
}

const STORAGE_KEY = "jarvis.schedule";
const listeners = new Set<() => void>();

const DEFAULT_EVENTS: ScheduleEvent[] = [
  { id: "1", time: "09:00", title: "Standup" },
  { id: "2", time: "13:30", title: "Design review" },
  { id: "3", time: "18:00", title: "Gym" },
];

function sortByTime(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((a, b) => a.time.localeCompare(b.time));
}

// Cached so repeated reads return a stable reference when nothing changed
// — required by useSyncExternalStore to avoid re-render loops.
let cachedRaw: string | null = null;
let cachedEvents: ScheduleEvent[] = DEFAULT_EVENTS;
let seeded = false;

export function readSchedule(): ScheduleEvent[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable — fall through to defaults
  }
  if (!seeded && raw === null) {
    // First-ever load: persist the starting defaults so they behave like
    // real data (e.g. survive being individually removed) rather than
    // reappearing every time storage happens to be empty.
    seeded = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_EVENTS));
    } catch {
      // ignore — just won't persist this session
    }
    raw = JSON.stringify(DEFAULT_EVENTS);
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedEvents = raw ? sortByTime(JSON.parse(raw)) : DEFAULT_EVENTS;
    } catch {
      cachedEvents = DEFAULT_EVENTS;
    }
  }
  return cachedEvents;
}

function writeSchedule(events: ScheduleEvent[]) {
  const sorted = sortByTime(events);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  } catch {
    // storage unavailable — edits just won't persist this session
  }
  listeners.forEach((l) => l());
}

export function addScheduleEvent(time: string, title: string): ScheduleEvent {
  const event: ScheduleEvent = { id: crypto.randomUUID(), time, title };
  writeSchedule([...readSchedule(), event]);
  return event;
}

// Matches loosely against title text (JARVIS won't have an exact id to
// work with from a spoken request like "cancel my gym session").
export function removeScheduleEventsByQuery(query: string): ScheduleEvent[] {
  const q = query.trim().toLowerCase();
  const removed = readSchedule().filter((e) => e.title.toLowerCase().includes(q));
  if (removed.length > 0) {
    writeSchedule(readSchedule().filter((e) => !removed.includes(e)));
  }
  return removed;
}

export function removeScheduleEventById(id: string) {
  writeSchedule(readSchedule().filter((e) => e.id !== id));
}

export function updateScheduleEvent(id: string, updates: Partial<Pick<ScheduleEvent, "time" | "title">>) {
  writeSchedule(readSchedule().map((e) => (e.id === id ? { ...e, ...updates } : e)));
}

export function subscribeSchedule(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getScheduleServerSnapshot(): ScheduleEvent[] {
  return DEFAULT_EVENTS;
}
