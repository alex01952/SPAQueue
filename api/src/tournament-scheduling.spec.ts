import {
  generateTournamentSchedule,
  randomizeTournamentPools,
} from './tournament-scheduling';

describe('Tournament pool scheduling', () => {
  it.each([[8, 2], [7, 3], [2, 1], [11, 4]])(
    'distributes %i intact teams evenly across %i pools',
    (teamCount, poolCount) => {
      const ids = Array.from({ length: teamCount }, (_, index) => `team-${index}`);
      const pools = randomizeTournamentPools(ids, poolCount);
      expect(pools).toHaveLength(poolCount);
      expect(pools.flatMap((pool) => pool.registrationIds).sort()).toEqual([...ids].sort());
      const sizes = pools.map((pool) => pool.registrationIds.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
      expect(ids[0]).toBe('team-0');
    },
  );

  it.each([1, 2, 3, 5, 20])(
    'schedules every pair exactly once without double-booking with %i courts',
    (courts) => {
      const pools = [
        { number: 1, registrationIds: ['a', 'b', 'c', 'd', 'e'] },
        { number: 2, registrationIds: ['f', 'g', 'h'] },
      ];
      const schedule = generateTournamentSchedule(pools, courts);
      const expectedPairs = pools.flatMap((pool) =>
        pool.registrationIds.flatMap((first, index) =>
          pool.registrationIds.slice(index + 1).map((second) => `${first}:${second}`),
        ),
      );
      const actualPairs: string[] = [];
      for (const [index, slot] of schedule.entries()) {
        expect(slot.number).toBe(index + 1);
        expect(slot.matches.length).toBeGreaterThan(0);
        expect(slot.matches.length).toBeLessThanOrEqual(courts);
        const teams = slot.matches.flatMap((match) => [match.teamOneId, match.teamTwoId]);
        expect(new Set(teams).size).toBe(teams.length);
        expect(new Set(slot.matches.map((match) => match.courtNumber)).size).toBe(slot.matches.length);
        for (const match of slot.matches) {
          expect(match.courtNumber).toBeGreaterThanOrEqual(1);
          expect(match.courtNumber).toBeLessThanOrEqual(courts);
          const pool = pools.find((item) => item.number === match.poolNumber)!;
          expect(pool.registrationIds).toContain(match.teamOneId);
          expect(pool.registrationIds).toContain(match.teamTwoId);
          actualPairs.push([match.teamOneId, match.teamTwoId].sort().join(':'));
        }
      }
      expect(actualPairs.sort()).toEqual(expectedPairs.sort());
    },
  );

  it('assigns balanced pools to dedicated courts when their counts match', () => {
    const pools = [
      { number: 1, registrationIds: ['a', 'b', 'c', 'd'] },
      { number: 2, registrationIds: ['e', 'f', 'g', 'h'] },
    ];
    const matches = generateTournamentSchedule(pools, 2).flatMap((slot) => slot.matches);
    expect(matches).toHaveLength(12);
    expect(matches.every((match) => match.courtNumber === match.poolNumber)).toBe(true);
  });
});
