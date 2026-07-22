"use client";

import { useEffect, useRef, useState } from "react";
import { RESET_PANELS_EVENT } from "@/lib/panelReset";

interface DraggableProps {
  id: string; // localStorage key suffix, so each panel remembers its own spot
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

const STORAGE_PREFIX = "jarvis.panelPos.";
// Below this, a press is treated as a tap/click, not a drag — otherwise
// the couple of pixels of natural hand/mouse jitter on any click would
// nudge the panel and make simple taps (e.g. a Notes button) feel broken.
const DRAG_THRESHOLD_PX = 4;
// Brief pause after the saved position appears before it swiftly slides
// back home — long enough to read as "snap back", not so long it feels
// like a delayed layout shift.
const RESET_DELAY_MS = 250;

export default function Draggable({ id, className, style, children }: DraggableProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  // Off during the initial localStorage restore (that jump should be
  // instant, not animated), on for every reset afterward — drag/tap moves
  // never animate either way since pos updates continuously while dragging.
  const [animated, setAnimated] = useState(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resetHome = () => {
    setAnimated(true);
    setPos({ x: 0, y: 0 });
    try {
      localStorage.removeItem(STORAGE_PREFIX + id);
    } catch {
      // storage unavailable — nothing to clear
    }
  };

  useEffect(() => {
    // Deferred a tick: both server and the first client render start at
    // {0,0} so there's no hydration mismatch, and this restores the saved
    // spot immediately after — a genuine sync-with-localStorage-on-mount,
    // just not literally the first synchronous statement in the effect.
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(STORAGE_PREFIX + id);
        const saved = raw ? JSON.parse(raw) : null;
        if (saved && (saved.x !== 0 || saved.y !== 0)) {
          setPos(saved); // instant jump — animated is still off here
          // Every fresh app open re-centers the layout: show where it was
          // left for a beat, then swiftly animate it back to default.
          resetTimerRef.current = setTimeout(resetHome, RESET_DELAY_MS);
        }
      } catch {
        // corrupted storage — just start at the default position
      }
    });

    const onResetEvent = () => resetHome();
    window.addEventListener(RESET_PANELS_EVENT, onResetEvent);
    return () => {
      clearTimeout(resetTimerRef.current);
      window.removeEventListener(RESET_PANELS_EVENT, onResetEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Don't hijack clicks on real controls inside the panel (Notes' input/
    // button, News' country tabs and headline links, etc).
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, button, a, select")) return;

    // Grabbing the panel mid-reset should feel like grabbing it, not like
    // it's yanked back home a beat later out from under the cursor.
    clearTimeout(resetTimerRef.current);

    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    setPos({ x: drag.origX + dx, y: drag.origY + dy });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    setDragging(false);
    if (drag.moved) {
      setPos((p) => {
        try {
          localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(p));
        } catch {
          // storage unavailable — position just won't persist this session
        }
        return p;
      });
    }
  };

  return (
    <div
      className={className}
      style={{
        ...style,
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        transition:
          animated && !dragging ? "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        cursor: dragging ? "grabbing" : "grab",
        touchAction: "none",
        position: "relative",
        zIndex: dragging ? 30 : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {children}
    </div>
  );
}
