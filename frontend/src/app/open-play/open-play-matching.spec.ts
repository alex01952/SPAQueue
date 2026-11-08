import { MatchingPlayer, suggestNextOpenPlayMatch, suggestOpenPlayMatch } from './open-play-matching';

describe('Open Play match suggestions', () => {
  const player = (id: string, values: Partial<MatchingPlayer> = {}): MatchingPlayer => ({
    id, category: 'Intermediate', line: 'normal', waitMs: 0, wins: 0, games: 0, ...values,
  });
  const ids = (players: MatchingPlayer[]) => players.map((entry) => entry.id);

  it('chooses the eligible line with the greater combined waiting time before selecting a court', () => {
    const normal = Array.from({ length: 4 }, (_, index) => player(`normal-${index}`, { waitMs: 10 * 60000 }));
    const winners = Array.from({ length: 4 }, (_, index) => player(`winner-${index}`, { line: 'winners', waitMs: 20 * 60000 }));
    const result = suggestNextOpenPlayMatch([...normal, ...winners])!;
    expect(result.teams.flat().every((entry) => entry.line === 'winners')).toBe(true);
    expect(result.totalWaitMs).toBe(80 * 60000);
    expect(result.category).toBe('Intermediate');
  });

  it('routes the selectable wait-time mode through the existing strategy', () => {
    const players = Array.from({ length: 4 }, (_, index) => player(`player-${index}`, { waitMs: index * 60000 }));
    expect(suggestNextOpenPlayMatch(players, 'wait-priority')).toEqual(suggestNextOpenPlayMatch(players));
  });

  it('keeps every eligible locked group together in the suggestion', () => {
    for (const size of [2, 3, 4]) {
      const locked = Array.from({ length: size }, (_, index) => player(`locked-${size}-${index}`, { waitMs: 35 * 60000 }));
      const fillers = Array.from({ length: 4 }, (_, index) => player(`filler-${size}-${index}`));
      const result = suggestNextOpenPlayMatch([...locked, ...fillers], undefined, [ids(locked)])!;
      expect(ids(result.teams.flat())).toEqual(expect.arrayContaining(ids(locked)));
      expect(result.teams.flat()).toHaveLength(4);
    }
  });

  it('does not suggest only the eligible members of a partly unavailable lock', () => {
    const locked = player('locked');
    const fillers = Array.from({ length: 4 }, (_, index) => player(`filler-${index}`));
    const result = suggestNextOpenPlayMatch([locked, ...fillers], undefined, [['locked', 'not-arrived']])!;
    expect(ids(result.teams.flat())).not.toContain('locked');
    expect(ids(result.teams.flat())).toEqual(expect.arrayContaining(ids(fillers)));
  });

  it('forces suggestions to the selected category while retaining qualified adjacent-level promotion', () => {
    const novice = Array.from({ length: 4 }, (_, index) => player(`novice-${index}`, { category: 'Novice', waitMs: 30 * 60000 }));
    const highIntermediate = Array.from({ length: 4 }, (_, index) => player(`high-${index}`, { category: 'High Intermediate' }));
    const forced = suggestNextOpenPlayMatch([...novice, ...highIntermediate], undefined, [], 'High Intermediate')!;
    expect(forced.category).toBe('High Intermediate');
    expect(forced.teams.flat().every((entry) => entry.category === 'High Intermediate')).toBe(true);
    const locked = suggestNextOpenPlayMatch([...novice, ...highIntermediate], undefined, [[highIntermediate[0].id, highIntermediate[1].id]], 'High Intermediate')!;
    expect(locked.teams.flat().map((entry) => entry.id)).toEqual(expect.arrayContaining([highIntermediate[0].id, highIntermediate[1].id]));

    const promoted = [
      player('intermediate', { category: 'Intermediate', wins: 4, games: 5 }),
      ...highIntermediate.slice(0, 3).map((entry, index) => ({ ...entry, wins: index + 1, games: 5 })),
    ];
    const mixed = suggestNextOpenPlayMatch(promoted, undefined, [], 'High Intermediate')!;
    expect(mixed.category).toBe('High Intermediate');
    expect(mixed.mixedLevels).toBe(true);
    const nearest = suggestNextOpenPlayMatch(novice, undefined, [], 'High Intermediate')!;
    expect(nearest.category).toBe('Novice');
    expect(nearest.teams.flat().every((entry) => entry.category === 'Novice')).toBe(true);
  });

  it('fills a forced category with the closest level across both lines', () => {
    const high = Array.from({ length: 2 }, (_, index) => player(`high-${index}`, { category: 'High Intermediate' }));
    const intermediate = Array.from({ length: 2 }, (_, index) => player(`intermediate-${index}`, { category: 'Intermediate', line: 'winners' }));
    const result = suggestNextOpenPlayMatch([...high, ...intermediate], undefined, [], 'High Intermediate')!;
    expect(ids(result.teams.flat())).toEqual(expect.arrayContaining([...ids(high), ...ids(intermediate)]));
    expect(result.category).toBe('High Intermediate');
    expect(result.mixedLevels).toBe(true);
    expect(result.mixedLines).toBe(true);
  });

  it('chooses the normal line on equal total waits and ignores incomplete lines', () => {
    const normal = Array.from({ length: 4 }, (_, index) => player(`normal-${index}`, { waitMs: 60000 }));
    const winners = Array.from({ length: 4 }, (_, index) => player(`winner-${index}`, { line: 'winners', waitMs: 60000 }));
    expect(suggestNextOpenPlayMatch([...normal, ...winners])!.teams.flat().every((entry) => entry.line === 'normal')).toBe(true);
    expect(suggestNextOpenPlayMatch([...normal, ...winners.slice(0, 3)])!.teams.flat().every((entry) => entry.line === 'normal')).toBe(true);
  });

  it('compares valid groups of different levels by their combined waits', () => {
    const normal = Array.from({ length: 4 }, (_, index) => player(`normal-${index}`, { category: 'Novice', waitMs: 30000 }));
    const winners = Array.from({ length: 4 }, (_, index) => player(`winner-${index}`, { category: 'High Intermediate', line: 'winners', waitMs: 60000 }));
    expect(suggestNextOpenPlayMatch([...normal, ...winners])!.category).toBe('High Intermediate');
  });

  it('mixes lines only when neither line can produce a suitable group', () => {
    const normal = [player('one'), player('two')];
    const winners = [player('three', { line: 'winners' }), player('four', { line: 'winners' })];
    expect(suggestNextOpenPlayMatch([...normal, ...winners])?.mixedLines).toBe(true);
    expect(suggestNextOpenPlayMatch([...normal, ...winners.slice(0, 1)])).toBeNull();
  });

  it('uses the same line and level in order when enough players are available', () => {
    const players = [player('one'), player('two'), player('three'), player('four'), player('winner', { line: 'winners' })];
    const result = suggestOpenPlayMatch(players, 'Intermediate')!;
    expect(ids(result.teams.flat())).toEqual(['one', 'four', 'two', 'three']);
    expect(result.mixedLines).toBe(false);
  });

  it('mixes lines only when needed and prioritizes players approaching the warning', () => {
    const players = [player('one'), player('two'), player('winner', { line: 'winners', waitMs: 29 * 60000 }), player('other', { line: 'winners' })];
    const result = suggestOpenPlayMatch(players, 'Intermediate')!;
    expect(result.mixedLines).toBe(true);
    expect(result.teams.flat().find((entry) => entry.id === 'winner')).toBeTruthy();
    expect(suggestOpenPlayMatch(players.slice(0, 3), 'Intermediate')).toBeNull();
  });

  it('selects a long-waiting player even when later in the line', () => {
    const players = [player('one'), player('two'), player('three'), player('four'), player('waiting', { waitMs: 30 * 60000 })];
    expect(ids(suggestOpenPlayMatch(players, 'Intermediate')!.teams.flat())).toContain('waiting');
  });

  it('suggests adjacent-level promotion only with enough results and lower higher-level win rates', () => {
    const players = [player('lower', { category: 'Novice', wins: 4, games: 5, waitMs: 30 * 60000 }),
      player('higher1', { wins: 1, games: 5 }), player('higher2', { wins: 2, games: 5 }), player('higher3', { wins: 3, games: 5 })];
    expect(suggestOpenPlayMatch(players, 'Intermediate')?.mixedLevels).toBe(true);
    expect(suggestOpenPlayMatch([{ ...players[0], games: 4 }, ...players.slice(1)], 'Intermediate')).toBeNull();
    expect(suggestOpenPlayMatch([{ ...players[0], games: 10 }, ...players.slice(1)], 'Intermediate')).toBeNull();
    expect(suggestOpenPlayMatch([players[0], ...players.slice(1).map((entry) => ({ ...entry, wins: 5 }))], 'Intermediate')).toBeNull();
    expect(suggestOpenPlayMatch(players, 'High Intermediate')).toBeNull();
  });

  it('prefers lower winning percentages among qualified higher-level players', () => {
    const players = [player('lower', { category: 'Novice', wins: 4, games: 5, waitMs: 30 * 60000 }),
      player('higher3', { wins: 3, games: 5 }), player('higher2', { wins: 2, games: 5 }),
      player('higher1', { wins: 1, games: 5 }), player('higher0', { wins: 0, games: 5 })];
    const selected = ids(suggestOpenPlayMatch(players, 'Intermediate')!.teams.flat());
    expect(selected).toEqual(expect.arrayContaining(['lower', 'higher0', 'higher1', 'higher2']));
    expect(selected).not.toContain('higher3');
  });

  it('keeps qualified mixed-level matches in one line when that line has enough players', () => {
    const players = [player('lower', { category: 'Novice', wins: 4, games: 5, waitMs: 30 * 60000 }),
      player('higher1', { wins: 3, games: 5 }), player('higher2', { wins: 3, games: 5 }),
      player('higher3', { wins: 3, games: 5 }), player('other-line', { line: 'winners', wins: 0, games: 5 })];
    const result = suggestOpenPlayMatch(players, 'Intermediate')!;
    expect(result.mixedLevels).toBe(true);
    expect(result.mixedLines).toBe(false);
    expect(ids(result.teams.flat())).not.toContain('other-line');
  });

  it('balances two promoted players across teams and requires five games from higher-level players', () => {
    const players = [player('low1', { category: 'Novice', wins: 4, games: 5, waitMs: 30 * 60000 }),
      player('low2', { category: 'Novice', wins: 4, games: 5 }),
      player('high1', { wins: 1, games: 5 }), player('high2', { wins: 2, games: 5 })];
    const result = suggestOpenPlayMatch(players, 'Intermediate')!;
    expect(result.teams.every((team) => new Set(team.map((entry) => entry.category)).size === 2)).toBe(true);
    expect(suggestOpenPlayMatch(players.map((entry) => entry.id === 'high2' ? { ...entry, games: 4 } : entry), 'Intermediate')).toBeNull();
  });
});