"use client";

import { getTodaysQuote, getTodaysWord } from "@/lib/dailyContent";

export default function DailyPanel() {
  const quote = getTodaysQuote();
  const word = getTodaysWord();

  return (
    <div className="flex h-full flex-col gap-4" suppressHydrationWarning>
      <div>
        <h2 className="mb-2 text-xs uppercase tracking-[0.3em] text-cyan-400/70 holo-text">
          Quote of the Day
        </h2>
        <p className="text-sm italic text-cyan-50/90">&ldquo;{quote.text}&rdquo;</p>
        <p className="mt-1 text-xs text-cyan-200/50">— {quote.author}</p>
      </div>
      <div className="border-t border-cyan-500/10 pt-3">
        <h2 className="mb-2 text-xs uppercase tracking-[0.3em] text-cyan-400/70 holo-text">
          Word of the Day
        </h2>
        <p className="text-sm text-cyan-50/90">
          <span className="font-semibold">{word.word}</span>{" "}
          <span className="text-cyan-200/40">/{word.pronunciation}/</span>
        </p>
        <p className="mt-1 text-xs text-cyan-200/60">{word.definition}</p>
      </div>
    </div>
  );
}
