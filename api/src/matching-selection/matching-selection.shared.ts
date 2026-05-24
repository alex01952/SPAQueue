import { CourtAssignment, Player, PlayerQueueState, TeamMatchingMode } from '../queue.types';
import { teamMatchingStrategies } from './matching-selection.registry';

export function buildCourts(
  players: PlayerQueueState[],
  matchingMode: TeamMatchingMode = 'dupr-balance',
): CourtAssignment[] {
  const courts: CourtAssignment[] = [];

  for (let index = 0; index < players.length; index += 4) {
    const courtPlayers = players.slice(index, index + 4);

    if (courtPlayers.length < 4) {
      break;
    }

    courts.push({
      courtNumber: courts.length + 1,
      players: courtPlayers,
      teams: buildTeams(courtPlayers, matchingMode),
    });
  }

  return courts;
}

export function buildTeams(players: Player[], matchingMode: TeamMatchingMode = 'dupr-balance') {
  const strategy = teamMatchingStrategies[matchingMode];

  if (!strategy) {
    throw new Error(`Unsupported team matching mode: ${matchingMode}`);
  }

  return strategy.buildTeams({ players });
}