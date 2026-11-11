export type OpenPlayCategory = 'Novice' | 'Intermediate' | 'High Intermediate';

export interface BenchClock { accumulatedMs: number; since: string | null; }

export function benchMilliseconds(clock: BenchClock, now: number): number {
  return clock.accumulatedMs + (clock.since ? Math.max(0, now - Date.parse(clock.since)) : 0);
}

export function pauseBench(clock: BenchClock, now: number): BenchClock {
  return { accumulatedMs: benchMilliseconds(clock, now), since: null };
}

export function resumeBench(clock: BenchClock, now: number): BenchClock {
  return clock.since ? clock : { ...clock, since: new Date(now).toISOString() };
}

export function formatBenchTime(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function timeSinceGame(endedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(endedAt)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

export function parseParticipants(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const heading = lines.findIndex((line) => /^\s*participants\s*\(\s*\d+\s*\)\s*$/i.test(line));
  if (heading < 0) return [];

  const names: string[] = [];
  for (const line of lines.slice(heading + 1)) {
    const entry = line.match(/^\s*\d+\.\s*(\S.*)\s*$/);
    if (entry) {
      const name = entry[1].replace(/\s*\([^()]*\+\s*1\b[^()]*\)\s*/g, ' ').trim();
      if (name) names.push(name);
    } else if (line.trim()) {
      break;
    }
  }
  return names;
}

export function categoryFromSkills(skills: Record<string, number | null> | undefined): OpenPlayCategory | null {
  const ratings = Object.values(skills ?? {}).filter((rating): rating is number =>
    typeof rating === 'number' && Number.isFinite(rating),
  );
  if (!ratings.length) return null;
  const total = ratings.reduce((sum, rating) => sum + Math.min(Math.max(rating, 0), 10), 0);
  if (total <= 100) return 'Novice';
  if (total <= 150) return 'Intermediate';
  return 'High Intermediate';
}