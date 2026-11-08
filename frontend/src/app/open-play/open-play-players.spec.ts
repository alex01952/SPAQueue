import { benchMilliseconds, categoryFromSkills, formatBenchTime, parseParticipants, pauseBench, resumeBench, timeSinceGame } from './open-play-players';

describe('Open Play players', () => {
  it('accumulates active bench time while excluding paused periods', () => {
    const start = Date.parse('2026-11-08T10:00:00Z');
    const active = resumeBench({ accumulatedMs: 0, since: null }, start);
    const resting = pauseBench(active, start + 10 * 60000);
    expect(benchMilliseconds(resting, start + 30 * 60000)).toBe(10 * 60000);
    const resumed = resumeBench(resting, start + 30 * 60000);
    expect(benchMilliseconds(resumed, start + 35 * 60000)).toBe(15 * 60000);
    expect(pauseBench(resting, start + 40 * 60000)).toEqual(resting);
    expect(formatBenchTime(0)).toBe('<1m');
    expect(formatBenchTime(65 * 60000)).toBe('1h 5m');
  });
  it('formats time since the last game without negative waits', () => {
    const endedAt = '2026-11-08T10:00:00Z';
    const ended = Date.parse(endedAt);
    expect(timeSinceGame(endedAt, ended - 1000)).toBe('just now');
    expect(timeSinceGame(endedAt, ended + 59_000)).toBe('just now');
    expect(timeSinceGame(endedAt, ended + 12 * 60_000)).toBe('12m ago');
    expect(timeSinceGame(endedAt, ended + 75 * 60_000)).toBe('1h 15m ago');
    expect(timeSinceGame(endedAt, ended + 26 * 60 * 60_000)).toBe('1d 2h ago');
  });
  it('only reads numbered entries in the Participants section', () => {
    expect(parseParticipants('Coaches (1)\r\n1. Coach\r\n\r\nParticipants (2)\r\n1. Jenn\r\n2. JOM🇵🇭\r\n\r\n(1)\r\n1. Other\r\nRequested (1)\r\n1. Waiting'))
      .toEqual(['Jenn', 'JOM🇵🇭']);
    expect(parseParticipants('Coaches (1)\n1. Coach')).toEqual([]);
  });

  it('maps profile skill totals into the three Open Play categories', () => {
    const skills = (total: number) => Object.fromEntries(Array.from({ length: 25 }, (_, index) => [
      `skill${index}`, Math.max(0, Math.min(10, total - index * 10)),
    ]));
    expect(categoryFromSkills({})).toBeNull();
    expect(categoryFromSkills(skills(100))).toBe('Novice');
    expect(categoryFromSkills(skills(101))).toBe('Intermediate');
    expect(categoryFromSkills(skills(150))).toBe('Intermediate');
    expect(categoryFromSkills(skills(151))).toBe('High Intermediate');
    expect(categoryFromSkills(skills(250))).toBe('High Intermediate');
  });
});