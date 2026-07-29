import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type ThoughtCard,
  fetchNotesForDate,
  fetchThoughtDayCounts,
  formatApiDate,
} from "@/lib/featured-note";

// Shares the "@thoughts/" prefix so clearLocalUserData() wipes it on sign-out
// and account deletion — a cached feed must never outlive its account.
const CACHE_KEY = "@thoughts/feed-bootstrap-v1";

// Cached notes are only a paint-first placeholder; anything older than this is
// dropped rather than shown, since a stale feed is worse than a brief spinner.
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type FeedBootstrap = {
  counts: [string, number][];
  notes: [string, ThoughtCard[]][];
};

type CachedBootstrap = FeedBootstrap & { savedAt: number };

export function todayKey(): string {
  return formatApiDate(new Date());
}

export function yesterdayKey(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return formatApiDate(date);
}

export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function previousMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Merge the two months we always want counts for so `yesterday` is covered
// even when it falls into the previous calendar month.
export function initialMonths(): [string, string] {
  const current = monthKey(todayKey());
  return [current, previousMonth(current)];
}

export async function loadFeedBootstrap(): Promise<FeedBootstrap> {
  const today = todayKey();
  const yesterday = yesterdayKey();
  const [currentMonth, prevMonth] = initialMonths();

  const [currentCounts, prevCounts, todayNotes, yesterdayNotes] =
    await Promise.all([
      fetchThoughtDayCounts(currentMonth),
      fetchThoughtDayCounts(prevMonth),
      fetchNotesForDate(today),
      fetchNotesForDate(yesterday),
    ]);

  const counts = new Map<string, number>();
  for (const { date, count } of [...currentCounts, ...prevCounts]) {
    counts.set(date, count);
  }

  return {
    counts: [...counts],
    notes: [
      [today, todayNotes.notes],
      [yesterday, yesterdayNotes.notes],
    ],
  };
}

// --- prefetch -------------------------------------------------------------
// Started right after the session is restored so the feed requests overlap
// with /auth/me instead of queueing behind it.

let prefetch: Promise<FeedBootstrap> | null = null;

export function prefetchFeedBootstrap(): void {
  if (prefetch) return;
  // Swallow here so an early failure can never surface as an unhandled
  // rejection; the consumer re-throws when it awaits the same promise.
  prefetch = loadFeedBootstrap();
  prefetch.catch(() => undefined);
}

// Hands over the in-flight prefetch exactly once. Returns null when there is
// nothing pending, so the caller falls back to fetching itself.
export function consumeFeedBootstrapPrefetch(): Promise<FeedBootstrap> | null {
  const pending = prefetch;
  prefetch = null;
  return pending;
}

export function clearFeedBootstrapPrefetch(): void {
  prefetch = null;
}

// --- persisted cache ------------------------------------------------------

export async function readFeedCache(): Promise<FeedBootstrap | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedBootstrap;
    if (!cached?.savedAt || !Array.isArray(cached.counts)) return null;
    if (Date.now() - cached.savedAt > CACHE_MAX_AGE_MS) return null;
    // A cache written on an earlier day would paint yesterday's notes under
    // today's heading, so treat a date rollover as a miss.
    const cachedDays = cached.notes.map(([date]) => date);
    if (!cachedDays.includes(todayKey())) return null;
    return { counts: cached.counts, notes: cached.notes };
  } catch {
    return null;
  }
}

// Sign-out does not go through clearLocalUserData(), so the cache has to be
// dropped explicitly — otherwise the next account would paint the previous
// account's thoughts before its own feed arrives.
export async function clearFeedCache(): Promise<void> {
  prefetch = null;
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing to do; a failed clear must not block signing out.
  }
}

export async function writeFeedCache(data: FeedBootstrap): Promise<void> {
  try {
    const payload: CachedBootstrap = { ...data, savedAt: Date.now() };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // A cache write must never break the feed.
  }
}
