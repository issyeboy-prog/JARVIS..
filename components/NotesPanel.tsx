"use client";

import { useSyncExternalStore } from "react";

interface Note {
  id: string;
  text: string;
}

const STORAGE_KEY = "jarvis.notes";
const listeners = new Set<() => void>();

// Cached so repeated reads return a stable reference when nothing changed
// — required by useSyncExternalStore to avoid re-render loops.
let cachedRaw: string | null = null;
let cachedNotes: Note[] = [];

function readNotes(): Note[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to []
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedNotes = raw ? JSON.parse(raw) : [];
    } catch {
      cachedNotes = [];
    }
  }
  return cachedNotes;
}

function writeNotes(notes: Note[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // storage unavailable — edits just won't persist this session
  }
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// Must be a stable reference — useSyncExternalStore re-renders whenever
// the snapshot changes identity, so a fresh `[]` literal each call would
// loop forever.
const EMPTY_NOTES: Note[] = [];
function getServerSnapshot(): Note[] {
  return EMPTY_NOTES;
}

export default function NotesPanel() {
  const notes = useSyncExternalStore(subscribe, readNotes, getServerSnapshot);

  const addNote = (form: HTMLFormElement) => {
    const input = form.elements.namedItem("note") as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    writeNotes([...readNotes(), { id: crypto.randomUUID(), text }]);
    input.value = "";
  };

  const removeNote = (id: string) => {
    writeNotes(readNotes().filter((n) => n.id !== id));
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="text-xs uppercase tracking-[0.3em] text-cyan-400/70 holo-text">
        Notes
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addNote(e.currentTarget);
        }}
        className="flex gap-2"
      >
        <input
          name="note"
          placeholder="Jot something down…"
          className="min-w-0 flex-1 rounded-lg border border-cyan-500/15 bg-black/20 px-3 py-1.5 text-sm text-cyan-50 placeholder:text-cyan-200/30 focus:border-cyan-400/40 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg border border-cyan-400/30 px-3 text-sm text-cyan-200/80 transition hover:bg-cyan-500/10"
        >
          Add
        </button>
      </form>
      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {notes.map((n) => (
          <li
            key={n.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-cyan-500/10 bg-cyan-500/5 px-3 py-2 text-sm text-cyan-50/90"
          >
            <span>{n.text}</span>
            <button
              onClick={() => removeNote(n.id)}
              className="text-cyan-200/40 hover:text-cyan-200/80"
              aria-label="Remove note"
            >
              ×
            </button>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="text-sm text-cyan-200/40">No notes yet.</li>
        )}
      </ul>
    </div>
  );
}
