"use client";

import { useEffect, useState } from "react";

interface WeatherData {
  temperature: number;
  code: number;
}

// Open-Meteo needs no API key, so weather works out of the box.
const CODE_LABEL: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Drizzle",
  61: "Rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Showers",
  95: "Thunderstorm",
};

// Falls back to New York if geolocation is denied/unavailable.
const FALLBACK_COORDS = { latitude: 40.7128, longitude: -74.006 };

export default function WeatherPanel() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = (lat: number, lon: number) => {
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`
      )
        .then((r) => r.json())
        .then((data) => {
          setWeather({
            temperature: Math.round(data.current.temperature_2m),
            code: data.current.weather_code,
          });
        })
        .catch(() => setError(true));
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => load(pos.coords.latitude, pos.coords.longitude),
        () => load(FALLBACK_COORDS.latitude, FALLBACK_COORDS.longitude),
        { timeout: 5000 }
      );
    } else {
      load(FALLBACK_COORDS.latitude, FALLBACK_COORDS.longitude);
    }
  }, []);

  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="text-xs uppercase tracking-[0.3em] text-cyan-400/70">
        Weather
      </h2>
      {error && <p className="text-sm text-cyan-200/40">Unavailable.</p>}
      {!error && !weather && (
        <p className="text-sm text-cyan-200/40">Loading…</p>
      )}
      {weather && (
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl text-cyan-50">
            {weather.temperature}°C
          </span>
          <span className="text-sm text-cyan-200/70">
            {CODE_LABEL[weather.code] ?? "—"}
          </span>
        </div>
      )}
    </div>
  );
}
