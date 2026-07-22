"use client";

import { useEffect, useRef, useState } from "react";

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

export default function Draggable({ id, className, style, children }: DraggableProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    // Deferred a tick: both server and the first client render start at
    // {0,0} so there's no hydration mismatch, and this restores the saved
    // spot immediately after — a genuine sync-with-localStorage-on-mount,
    // just not literally the first synchronous statement in the effect.
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(STORAGE_PREFIX + id);
        if (raw) setPos(JSON.parse(raw));
      } catch {
        // corrupted storage — just start at the default position
      }
    });
  }, [id]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Don't hijack clicks on real controls inside the panel (Notes' input/
    // button, News' country tabs and headline links, etc).
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, button, a, select")) return;

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
