import { Game } from '../queue.types';

export function isPlayerInOngoingGame(games: Game[], playerId: number) {
  return games.some((game) => game.status === 'ongoing' && game.playerIds.includes(playerId));
}
