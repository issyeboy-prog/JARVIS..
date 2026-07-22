"use client";

import { useEffect, useState } from "react";

interface Headline {
  title: string;
  link: string;
  source: string;
  pubDate: string;
}

interface NewsResponse {
  usa: Headline[];
  canada: Headline[];
  china: Headline[];
}

const COUNTRIES: { key: keyof NewsResponse; label: string; flag: string }[] = [
  { key: "usa", label: "USA", flag: "🇺🇸" },
  { key: "canada", label: "Canada", flag: "🇨🇦" },
  { key: "china", label: "China", flag: "🇨🇳" },
];

export default function NewsPanel() {
  const [news, setNews] = useState<NewsResponse | null>(null);
  const [error, setError] = useState(false);
  const [active, setActive] = useState<keyof NewsResponse>("usa");

  useEffect(() => {
    fetch("/api/news")
      .then((r) => r.json())
      .then(setNews)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.3em] text-cyan-400/70 holo-text">
          World News
        </h2>
        <div className="flex gap-1">
          {COUNTRIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setActive(c.key)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                active === c.key
                  ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                  : "border-cyan-500/10 text-cyan-200/50 hover:bg-cyan-500/5"
              }`}
            >
              {c.flag} {c.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-cyan-200/40">Unavailable.</p>}
      {!error && !news && <p className="text-sm text-cyan-200/40">Loading…</p>}

      {news && (
        <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {news[active].map((h, i) => (
            <li key={i}>
              <a
                href={h.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-cyan-500/10 bg-cyan-500/5 px-3 py-2 text-sm text-cyan-50/90 transition hover:bg-cyan-500/10"
              >
                {h.title}
                {h.source && (
                  <span className="ml-2 text-xs text-cyan-200/40">
                    {h.source}
                  </span>
                )}
              </a>
            </li>
          ))}
          {news[active].length === 0 && (
            <li className="text-sm text-cyan-200/40">No headlines right now.</li>
          )}
        </ul>
      )}
    </div>
  );
}
