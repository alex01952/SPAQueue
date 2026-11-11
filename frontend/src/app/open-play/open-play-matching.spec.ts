import { MatchingPlayer, suggestNextOpenPlayMatch, suggestOpenPlayMatch } from './open-play-matching';

describe('Open Play match suggestions', () => {
  const player = (id: string, values: Partial<MatchingPlayer> = {}): MatchingPlayer => ({
    id, category: 'Intermediate', line: 'normal', waitMs: 0, wins: 0, games: 0, ...values,
  });
  const ids = (players: MatchingPlayer[]) => players.map((entry) => entry.id);

  it.each([
    ['Male', 'Male', 'Female', 'Female'],
    ['Male', 'Female', 'Male', 'Female'],
    ['Male', 'Female', 'Female', 'Male'],
    ['Female', 'Male', 'Male', 'Female'],
    ['Female', 'Male', 'Female', 'Male'],
    ['Female', 'Female', 'Male', 'Male'],
  ] as const)('forms mixed doubles for genders %s, %s, %s, %s', (...genders) => {
    const players = genders.map((gender, index) => player(`mixed-${index}`, { gender }));
    for (const forcedCategory of [null, 'Intermediate'] as const) {
      const suggestion = suggestNextOpenPlayMatch(players, 'wait-priority', [], forcedCategory)!;
      expect(ids(suggestion.teams.flat()).sort()).toEqual(ids(players).sort());
      for (const team of suggestion.teams) expect(team.map((entry) => entry.gender).sort()).toEqual(['Female', 'Male']);
    }
  });

  it('retains the existing pairing when genders are blank or incomplete', () => {
    const players = Array.from({ length: 4 }, (_, index) => player(`unknown-${index}`));
    const original = suggestNextOpenPlayMatch(players)!;
    expect(suggestNextOpenPlayMatch(players.map((entry) => ({ ...entry, gender: '' })))?.teams.map(ids)).toEqual(original.teams.map(ids));
    expect(suggestNextOpenPlayMatch(players.map((entry, index) => ({ ...entry, gender: index === 0 ? 'Female' : '' })))?.teams.map(ids)).toEqual(original.teams.map(ids));
  });

  it('chooses the more balanced mixed pairing using available win rates', () => {
    const players = [
      player('man-high', { gender: 'Male', wins: 9, games: 10 }),
      player('woman-high', { gender: 'Female', wins: 8, games: 10 }),
      player('woman-low', { gender: 'Female', wins: 2, games: 10 }),
      player('man-low', { gender: 'Male', wins: 1, games: 10 }),
    ];
    const result = suggestNextOpenPlayMatch(players)!;
    expect(result.teams.map(ids)).toEqual([['man-high', 'woman-low'], ['woman-high', 'man-low']]);
  });

  it('chooses the eligible line with the greater combined waiting time before selecting a court', () => {
    const normal = Array.from({ length: 4 }, (_, index) => player(`normal-${index}`, { waitMs: 10 * 60000 }));
    const winners = Array.from({ length: 4 }, (_, index) => player(`winner-${index}`, { line: 'winners', waitMs: 20 * 60000 }));
    const result = suggestNextOpenPlayMatch([...normal, ...winners])!;
    expect(result.teams.flat().every((entry) => entry.line === 'winners')).toBe(true);
    expect(result.totalWaitMs).toBe(80 * 60000);
    expect(result.category).toBe('Intermediate');
  });

  it.each([null, 'Intermediate' as const])('prioritizes the longest individual wait over combined wait with category %s', (category) => {
    const normal = Array.from({ length: 4 }, (_, index) => player(`regular-${index}`, { waitMs: index === 0 ? 10 * 60000 : 0 }));
    const winners = Array.from({ length: 4 }, (_, index) => player(`winners-${index}`, { line: 'winners', waitMs: 9 * 60000 }));
    const result = suggestNextOpenPlayMatch([...normal, ...winners], 'wait-priority', [], category)!;
    expect(result.mixedLines).toBe(false);
    expect(result.teams.flat().every((entry) => entry.line === 'normal')).toBe(true);
    const secondary = suggestNextOpenPlayMatch([...normal, ...winners], 'wait-priority', [], category, ids(result.teams.flat()))!;
    expect(secondary.mixedLines).toBe(false);
    expect(secondary.teams.flat().every((entry) => entry.line === 'winners')).toBe(true);
  });

  it('suggests a second category from the same queue without reusing the primary lineup', () => {
    const intermediate = Array.from({ length: 4 }, (_, index) => player(`intermediate-${index}`, { waitMs: 20 * 60000 }));
    const high = Array.from({ length: 5 }, (_, index) => player(`high-${index}`, { category: 'High Intermediate', waitMs: (10 - index) * 60000 }));
    const queue = [...intermediate, ...high];
    const original = structuredClone(queue);
    const primary = suggestNextOpenPlayMatch(queue, 'wait-priority', [], 'Intermediate')!;
    const secondary = suggestNextOpenPlayMatch(queue, 'wait-priority', [], 'High Intermediate', ids(primary.teams.flat()))!;
    expect(ids(primary.teams.flat())).toEqual(expect.arrayContaining(ids(intermediate)));
    expect(ids(secondary.teams.flat())).toEqual(expect.arrayContaining(ids(high.slice(0, 4))));
    expect(ids(secondary.teams.flat()).some((id) => ids(primary.teams.flat()).includes(id))).toBe(false);
    expect(queue).toEqual(original);
  });

  it('uses only the forced category for secondary even when its players are at the back and have shorter waits', () => {
    const primary = Array.from({ length: 4 }, (_, index) => player(`primary-${index}`));
    const waiting = Array.from({ length: 12 }, (_, index) => player(`front-${index}`, { waitMs: 40 * 60000 }));
    const high = Array.from({ length: 6 }, (_, index) => player(`back-high-${index}`, { category: 'High Intermediate', waitMs: 1000 }));
    const queue = [...primary, ...waiting, ...high];
    const result = suggestNextOpenPlayMatch(queue, 'wait-priority', [], 'High Intermediate', ids(primary))!;
    expect(result.teams.flat()).toHaveLength(4);
    expect(result.mixedLevels).toBe(false);
    expect(result.teams.flat().every((entry) => entry.category === 'High Intermediate')).toBe(true);
    expect(result.teams.flat().some((entry) => ids(primary).includes(entry.id))).toBe(false);
    expect(ids(queue)).toEqual([...ids(primary), ...ids(waiting), ...ids(high)]);
  });

  it('prefers a complete exact-category group even when other target players are locked to a lower category', () => {
    const lower = player('lower', { waitMs: 40 * 60000 });
    const high = Array.from({ length: 5 }, (_, index) => player(`high-${index}`, { category: 'High Intermediate', waitMs: index === 0 ? 40 * 60000 : 0 }));
    const result = suggestNextOpenPlayMatch([lower, ...high], 'wait-priority', [[lower.id, high[0].id]], 'High Intermediate')!;
    expect(ids(result.teams.flat())).toEqual(expect.arrayContaining(ids(high.slice(1))));
    expect(result.mixedLevels).toBe(false);
    expect(ids(result.teams.flat())).not.toContain(high[0].id);
  });

  it('keeps locks intact and returns no secondary match when fewer than four remain', () => {
    const players = Array.from({ length: 8 }, (_, index) => player(`player-${index}`));
    const primaryIds = ids(players.slice(0, 4));
    expect(suggestNextOpenPlayMatch(players, 'wait-priority', [], null, primaryIds)?.teams.flat()).toHaveLength(4);
    expect(suggestNextOpenPlayMatch(players, 'wait-priority', [[players[0].id, players[4].id]], null, primaryIds)).toBeNull();
    expect(suggestNextOpenPlayMatch(players.slice(0, 7), 'wait-priority', [], null, primaryIds)).toBeNull();
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

  it.each([null, 'Intermediate' as const])('randomizes tied complete lines reproducibly with category %s', (category) => {
    const normal = Array.from({ length: 4 }, (_, index) => player(`normal-${index}`, { waitMs: 60000 }));
    const winners = Array.from({ length: 4 }, (_, index) => player(`winner-${index}`, { line: 'winners', waitMs: 60000 }));
    const selectedLines = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const result = suggestNextOpenPlayMatch([...normal, ...winners], 'wait-priority', [], category, [], seed)!;
      expect(result.mixedLines).toBe(false);
      expect(suggestNextOpenPlayMatch([...normal, ...winners], 'wait-priority', [], category, [], seed)).toEqual(result);
      selectedLines.add(result.teams[0][0].line);
    }
    expect(selectedLines).toEqual(new Set(['normal', 'winners']));
    expect(suggestNextOpenPlayMatch([...normal, ...winners.slice(0, 3)], 'wait-priority', [], category)!.teams.flat().every((entry) => entry.line === 'normal')).toBe(true);
  });

  it('randomizes equal longest waits even when one line has a larger combined wait', () => {
    const normal = Array.from({ length: 4 }, (_, index) => player(`normal-${index}`, { waitMs: index === 0 ? 10 * 60000 : 0 }));
    const winners = Array.from({ length: 4 }, (_, index) => player(`winner-${index}`, { line: 'winners', waitMs: index === 0 ? 10 * 60000 : 9 * 60000 }));
    for (const category of [null, 'Intermediate'] as const) {
      const lines = new Set(Array.from({ length: 30 }, (_, seed) =>
        suggestNextOpenPlayMatch([...normal, ...winners], 'wait-priority', [], category, [], seed)!.teams[0][0].line,
      ));
      expect(lines).toEqual(new Set(['normal', 'winners']));
    }
  });

  it('compares valid groups of different levels by their longest waits', () => {
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