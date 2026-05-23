import { CourtAssignment, Game, NextGamePreview, Player, PlayerQueueState, Team } from './queue.types';

export interface QueueSelectionContext {
  players: PlayerQueueState[];
  games: Game[];
  courtCount: number;
}

export interface QueueSelectionStrategy {
  name: string;
  selectNextPlayers(context: QueueSelectionContext): NextGamePreview;
}

export class CheckInOrderQueueSelectionStrategy implements QueueSelectionStrategy {
  readonly name = 'check-in-order';

  selectNextPlayers(context: QueueSelectionContext): NextGamePreview {
    const courtCount = Math.max(1, Math.floor(context.courtCount || 1));
    const eligiblePlayers = context.players
      .filter((player) => player.isReady && !isPlayerInOngoingGame(context.games, player.id))
      .sort((left, right) => {
        if (!left.checkedInAt || !right.checkedInAt) {
          return left.name.localeCompare(right.name);
        }

        return left.checkedInAt.localeCompare(right.checkedInAt);
      });

    const selectedPlayers = eligiblePlayers.slice(0, courtCount * 4);

    return {
      courtCount,
      eligiblePlayers,
      selectedPlayers,
      courts: buildCourts(selectedPlayers),
    };
  }
}

export function buildCourts(players: PlayerQueueState[]): CourtAssignment[] {
  const courts: CourtAssignment[] = [];

  for (let index = 0; index < players.length; index += 4) {
    const courtPlayers = players.slice(index, index + 4);

    if (courtPlayers.length < 4) {
      break;
    }

    courts.push({
      courtNumber: courts.length + 1,
      players: courtPlayers,
      teams: buildTeams(courtPlayers),
    });
  }

  return courts;
}

export function buildTeams(players: Player[]): Team[] {
  if (players.length !== 4) {
    return [];
  }

  return [
    {
      name: 'Team 1',
      players: players.slice(0, 2),
    },
    {
      name: 'Team 2',
      players: players.slice(2, 4),
    },
  ];
}

export function isPlayerInOngoingGame(games: Game[], playerId: number) {
  return games.some((game) => game.status === 'ongoing' && game.playerIds.includes(playerId));
}