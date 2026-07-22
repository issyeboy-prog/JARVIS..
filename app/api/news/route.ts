import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";

// Google News RSS needs no API key. Rather than fetch native-language
// editions and machine-translate them (which needs a paid translation
// API), each query below is run against the English-US edition — so
// headlines are English by construction instead of requiring translation.
const COUNTRIES = {
  usa: "United States",
  canada: "Canada",
  china: "China",
} as const;

type CountryKey = keyof typeof COUNTRIES;

interface Headline {
  title: string;
  link: string;
  source: string;
  pubDate: string;
}

const parser = new XMLParser({ ignoreAttributes: false });

async function fetchCountryFeed(query: string): Promise<Headline[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-US&gl=US&ceid=US:en`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 600 }, // cache 10 minutes
  });
  if (!res.ok) throw new Error(`news-fetch-failed:${res.status}`);

  const xml = await res.text();
  const data = parser.parse(xml);
  const items = data?.rss?.channel?.item ?? [];
  const list = Array.isArray(items) ? items : [items];

  return list.slice(0, 6).map((item) => ({
    title: String(item.title ?? "").trim(),
    link: String(item.link ?? "").trim(),
    source: String(item.source?.["#text"] ?? item.source ?? "").trim(),
    pubDate: String(item.pubDate ?? "").trim(),
  }));
}

export async function GET() {
  const entries = Object.entries(COUNTRIES) as [CountryKey, string][];

  const results = await Promise.allSettled(
    entries.map(([, query]) => fetchCountryFeed(query))
  );

  const body: Record<CountryKey, Headline[]> = {
    usa: [],
    canada: [],
    china: [],
  };
  results.forEach((result, i) => {
    const [key] = entries[i];
    body[key] = result.status === "fulfilled" ? result.value : [];
  });

  return NextResponse.json(body);
}
