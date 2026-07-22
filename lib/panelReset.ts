"use client";

// A tiny event bus so voice control (which has no direct reference to any
// panel) can tell every Draggable panel to animate back to its default
// position — used by the "reset display" voice command.
export const RESET_PANELS_EVENT = "jarvis:reset-panels";

export function resetAllPanels() {
  window.dispatchEvent(new Event(RESET_PANELS_EVENT));
}
