export interface TournamentPool {
  number: number;
  registrationIds: string[];
}

export interface TournamentScheduleMatch {
  courtNumber: number;
  poolNumber: number;
  teamOneId: string;
  teamTwoId: string;
}

export interface TournamentScheduleSlot {
  number: number;
  matches: TournamentScheduleMatch[];
}

export interface TournamentDraw {
  version: string;
  rosterSignature: string;
  pools: TournamentPool[];
  courtCount: number;
  schedule: TournamentScheduleSlot[];
  updatedAt: string;
  updatedBy: string;
}

function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

export function randomizeTournamentPools(
  registrationIds: string[],
  poolCount: number,
): TournamentPool[] {
  const pools: TournamentPool[] = Array.from({ length: poolCount }, (_, index) => ({
    number: index + 1,
    registrationIds: [],
  }));
  shuffle([...registrationIds]).forEach((id, index) =>
    pools[index % poolCount].registrationIds.push(id),
  );
  return pools;
}

export function generateTournamentSchedule(
  pools: TournamentPool[],
  courtCount: number,
): TournamentScheduleSlot[] {
  const remaining = pools.flatMap((pool) => {
    const matches: Omit<TournamentScheduleMatch, 'courtNumber'>[] = [];
    for (let first = 0; first < pool.registrationIds.length - 1; first += 1) {
      for (let second = first + 1; second < pool.registrationIds.length; second += 1) {
        matches.push({
          poolNumber: pool.number,
          teamOneId: pool.registrationIds[first],
          teamTwoId: pool.registrationIds[second],
        });
      }
    }
    return shuffle(matches);
  });
  const dedicatedCourts = pools.length === courtCount &&
    pools.every((pool) => pool.registrationIds.length === pools[0].registrationIds.length);
  const schedule: TournamentScheduleSlot[] = [];
  let previousTeams = new Set<string>();

  while (remaining.length) {
    const usedTeams = new Set<string>();
    const matches: TournamentScheduleMatch[] = [];
    for (let court = 1; court <= courtCount; court += 1) {
      const eligible = remaining
        .map((match, index) => ({ match, index }))
        .filter(({ match }) =>
          (!dedicatedCourts || match.poolNumber === court) &&
          !usedTeams.has(match.teamOneId) && !usedTeams.has(match.teamTwoId),
        );
      const choice = eligible.find(({ match }) =>
        !previousTeams.has(match.teamOneId) && !previousTeams.has(match.teamTwoId),
      ) ?? eligible[0];
      if (!choice) {
        if (dedicatedCourts) continue;
        break;
      }
      const match = remaining.splice(choice.index, 1)[0];
      matches.push({ ...match, courtNumber: court });
      usedTeams.add(match.teamOneId);
      usedTeams.add(match.teamTwoId);
    }
    schedule.push({ number: schedule.length + 1, matches });
    previousTeams = usedTeams;
  }
  return schedule;
}
