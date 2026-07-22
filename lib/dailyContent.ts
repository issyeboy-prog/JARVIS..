// Shared between the UI panels (SchedulePanel, DailyPanel) and the voice
// assistant's briefing context, so both read from one source of truth.

export interface ScheduleEvent {
  id: string;
  time: string;
  title: string;
}

// Mock data for now — shaped so a real Google Calendar fetch can drop in
// later without touching callers.
export const MOCK_EVENTS: ScheduleEvent[] = [
  { id: "1", time: "09:00", title: "Standup" },
  { id: "2", time: "13:30", title: "Design review" },
  { id: "3", time: "18:00", title: "Gym" },
];

export interface Quote {
  text: string;
  author: string;
}

// Curated locally rather than fetched — this only needs to change once a
// day, so a real-time API would just be another external dependency (and
// another thing that can fail) for no real benefit.
export const QUOTES: Quote[] = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
  { text: "What we think, we become.", author: "Buddha" },
  { text: "The unexamined life is not worth living.", author: "Socrates" },
  { text: "Whatever you are, be a good one.", author: "Abraham Lincoln" },
  { text: "The best way out is always through.", author: "Robert Frost" },
  { text: "Not all those who wander are lost.", author: "J.R.R. Tolkien" },
  { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "The journey of a thousand miles begins with one step.", author: "Lao Tzu" },
  { text: "Do or do not. There is no try.", author: "Yoda" },
  { text: "Well done is better than well said.", author: "Benjamin Franklin" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "Everything you can imagine is real.", author: "Pablo Picasso" },
  { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { text: "Turn your wounds into wisdom.", author: "Oprah Winfrey" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" },
  { text: "Genius is one percent inspiration and ninety-nine percent perspiration.", author: "Thomas Edison" },
  { text: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
  { text: "The mind is everything. What you think you become.", author: "Buddha" },
  { text: "Strive not to be a success, but rather to be of value.", author: "Albert Einstein" },
  { text: "Two roads diverged in a wood, and I took the one less traveled by.", author: "Robert Frost" },
  { text: "I have not failed. I've just found 10,000 ways that won't work.", author: "Thomas Edison" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "Success is not final, failure is not fatal.", author: "Winston Churchill" },
  { text: "The only limit to our realization of tomorrow is our doubts of today.", author: "Franklin D. Roosevelt" },
  { text: "Happiness is not something ready made. It comes from your own actions.", author: "Dalai Lama" },
  { text: "You are never too old to set another goal.", author: "C.S. Lewis" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "Quality is not an act, it is a habit.", author: "Aristotle" },
];

export interface WordOfDay {
  word: string;
  pronunciation: string;
  definition: string;
}

export const WORDS: WordOfDay[] = [
  { word: "Ephemeral", pronunciation: "ih-FEM-er-al", definition: "Lasting for a very short time." },
  { word: "Serendipity", pronunciation: "ser-en-DIP-i-tee", definition: "A pleasant surprise found by chance." },
  { word: "Ubiquitous", pronunciation: "yoo-BIK-wi-tus", definition: "Present or found everywhere." },
  { word: "Mellifluous", pronunciation: "meh-LIF-loo-us", definition: "Sweet or musical; pleasant to hear." },
  { word: "Cognizant", pronunciation: "KOG-ni-zant", definition: "Having knowledge or awareness of something." },
  { word: "Ineffable", pronunciation: "in-EF-uh-bul", definition: "Too great to be expressed in words." },
  { word: "Quintessential", pronunciation: "kwin-tuh-SEN-shul", definition: "Representing the most perfect example of a quality." },
  { word: "Resilience", pronunciation: "ri-ZIL-yens", definition: "The capacity to recover quickly from difficulties." },
  { word: "Luminous", pronunciation: "LOO-mi-nus", definition: "Full of or emitting light; bright." },
  { word: "Paradigm", pronunciation: "PAIR-uh-dime", definition: "A typical example or pattern of something." },
  { word: "Eloquent", pronunciation: "EL-uh-kwent", definition: "Fluent and persuasive in speaking or writing." },
  { word: "Nostalgia", pronunciation: "no-STAL-juh", definition: "Sentimental longing for the past." },
  { word: "Tenacious", pronunciation: "tuh-NAY-shus", definition: "Persistent and determined; not easily giving up." },
  { word: "Whimsical", pronunciation: "WHIM-zi-kul", definition: "Playfully quaint or fanciful." },
  { word: "Sonder", pronunciation: "SON-der", definition: "The realization that each passerby has a life as vivid as your own." },
  { word: "Effervescent", pronunciation: "ef-er-VES-ent", definition: "Vivacious and enthusiastic; bubbly." },
  { word: "Labyrinthine", pronunciation: "lab-uh-RIN-thin", definition: "Intricate and confusing, like a maze." },
  { word: "Perspicacious", pronunciation: "per-spi-KAY-shus", definition: "Having keen insight or judgment." },
  { word: "Sanguine", pronunciation: "SANG-gwin", definition: "Optimistic or positive, especially in a difficult situation." },
  { word: "Vicarious", pronunciation: "vy-KAIR-ee-us", definition: "Experienced through the feelings or actions of another." },
  { word: "Zenith", pronunciation: "ZEE-nith", definition: "The highest point reached; the peak." },
  { word: "Halcyon", pronunciation: "HAL-see-un", definition: "Denoting a period of calm and happiness." },
  { word: "Eloquence", pronunciation: "EL-uh-kwens", definition: "Fluent, persuasive speaking or writing." },
  { word: "Fortuitous", pronunciation: "for-TOO-i-tus", definition: "Happening by lucky chance." },
  { word: "Gossamer", pronunciation: "GOS-uh-mer", definition: "Something light, delicate, and insubstantial." },
  { word: "Incandescent", pronunciation: "in-kan-DES-ent", definition: "Emitting light as a result of being heated; brilliant." },
  { word: "Juxtapose", pronunciation: "JUK-stuh-pohz", definition: "To place side by side for contrasting effect." },
  { word: "Kindle", pronunciation: "KIN-dul", definition: "To light a fire, or to arouse an emotion." },
  { word: "Meraki", pronunciation: "meh-RAH-kee", definition: "Doing something with soul, creativity, and love." },
  { word: "Wanderlust", pronunciation: "WON-der-lust", definition: "A strong desire to travel and explore the world." },
];

export function dayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

export function getTodaysQuote(): Quote {
  return QUOTES[dayOfYear() % QUOTES.length];
}

export function getTodaysWord(): WordOfDay {
  return WORDS[dayOfYear() % WORDS.length];
}
