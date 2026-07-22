"use client";

interface Notification {
  id: string;
  text: string;
  level: "info" | "warn";
}

// Local placeholder feed — wire up real alerts (email, calendar reminders,
// etc.) here once those integrations exist.
const MOCK_NOTIFICATIONS: Notification[] = [
  { id: "1", text: "System nominal.", level: "info" },
];

export default function NotificationsPanel() {
  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="text-xs uppercase tracking-[0.3em] text-cyan-400/70">
        Notifications
      </h2>
      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {MOCK_NOTIFICATIONS.map((n) => (
          <li
            key={n.id}
            className={`rounded-lg border px-3 py-2 text-sm ${
              n.level === "warn"
                ? "border-amber-500/20 bg-amber-500/5 text-amber-200/90"
                : "border-cyan-500/10 bg-cyan-500/5 text-cyan-50/90"
            }`}
          >
            {n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
