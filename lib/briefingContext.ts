"use client";

import { getTodaysQuote, getTodaysWord } from "./dailyContent";
import { readSchedule } from "./scheduleStore";

// Gathers everything JARVIS needs to answer things like "give me a daily
// briefing" with real data instead of guessing. Sent alongside every voice
// command (not just briefing requests) so it can also answer one-off
// questions like "what's on my schedule" accurately — cheap/instant
// sources are always included; weather and news are fetched with a short
// timeout and simply omitted from the context if they don't come back in
// time, rather than blocking the response.

const FALLBACK_COORDS = { latitude: 40.7128, longitude: -74.006 };
const WEATHER_CODE_LABEL: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "foggy",
  51: "drizzling",
  61: "raining",
  63: "raining",
  65: "raining heavily",
  71: "snowing",
  73: "snowing",
  75: "snowing heavily",
  80: "showers",
  95: "thunderstorms",
};

function getCoords(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(FALLBACK_COORDS);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(FALLBACK_COORDS),
      { timeout: 2500 }
    );
  });
}

async function getWeatherLine(): Promise<string | null> {
  try {
    const { latitude, longitude } = await getCoords();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const temp = Math.round(data.current.temperature_2m);
    const label = WEATHER_CODE_LABEL[data.current.weather_code];
    return `${temp}°C${label ? `, ${label}` : ""}`;
  } catch {
    return null;
  }
}

async function getNewsLines(): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("/api/news", { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, { title: string }[]>;
    const headlines: string[] = [];
    for (const key of ["usa", "canada", "china"]) {
      const top = data[key]?.[0]?.title;
      if (top) headlines.push(top);
    }
    return headlines;
  } catch {
    return [];
  }
}

export async function buildBriefingContext(): Promise<string> {
  const now = new Date();
  const [weatherLine, newsLines] = await Promise.all([getWeatherLine(), getNewsLines()]);
  const quote = getTodaysQuote();
  const word = getTodaysWord();
  const events = readSchedule();

  const lines = [
    `Current date: ${now.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })}`,
    `Current time: ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    `Weather: ${weatherLine ?? "unavailable"}`,
    `Today's schedule: ${
      events.length
        ? events.map((e) => `${e.time} ${e.title}`).join("; ")
        : "nothing scheduled"
    }`,
    `Top news headlines: ${newsLines.length ? newsLines.join(" | ") : "unavailable"}`,
    `Quote of the day: "${quote.text}" — ${quote.author}`,
    `Word of the day: ${word.word} — ${word.definition}`,
  ];
  return lines.join("\n");
}
