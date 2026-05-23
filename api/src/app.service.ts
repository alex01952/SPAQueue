import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import playerSeedData from './data/players.json';
import {
  buildTeams,
  CheckInOrderQueueSelectionStrategy,
  isPlayerInOngoingGame,
} from './queue-selection.logic';
import { Game, GameScore, Player, PlayerQueueState } from './queue.types';

@Injectable()
export class AppService {
  private readonly players: Player[] = (playerSeedData as Player[]).map((player) => ({
    ...player,
  }));
  private readonly queueSelectionStrategy = new CheckInOrderQueueSelectionStrategy();

  private readonly games: Game[] = [
    {
      id: 1,
      status: 'ongoing',
      playerIds: [1, 2, 3, 5],
      createdAt: '2026-05-23T08:15:00.000Z',
      completedAt: null,
      score: null,
    },
    {
      id: 2,
      status: 'completed',
      playerIds: [4, 6, 2, 3],
      createdAt: '2026-05-23T07:40:00.000Z',
      completedAt: '2026-05-23T08:05:00.000Z',
      score: { team1: 11, team2: 8 },
    },
  ];

  getQueueSnapshot(courtCount = 1) {
    const recentCompletedGames = this.getRecentCompletedGames();
    const playerQueueStates = this.players.map((player) =>
      this.toPlayerQueueState(player, recentCompletedGames),
    );
    const ongoingGames = this.games
      .filter((game) => game.status === 'ongoing')
      .map((game) => this.toGameView(game));
    const recentGames = recentCompletedGames.map((game) => this.toGameView(game));

    return {
      players: playerQueueStates,
      ongoingGames,
      recentGames,
      nextGame: this.buildNextGamePreview(playerQueueStates, courtCount),
    };
  }

  updatePlayerReadyState(playerId: number, isReady: boolean) {
    const player = this.players.find((entry) => entry.id === playerId);

    if (!player) {
      throw new NotFoundException(`Player ${playerId} was not found.`);
    }

    player.isReady = isReady;
    player.checkedInAt = isReady ? new Date().toISOString() : null;

    return {
      ...player,
      isPlaying: this.isPlayerInOngoingGame(player.id),
    };
  }

  createGame(playerIds: number[]) {
    return this.createSingleGame(playerIds);
  }

  createGames(playerGroups: number[][]) {
    if (!playerGroups.length) {
      throw new BadRequestException('At least one game is required.');
    }

    return playerGroups.map((playerIds) => this.createSingleGame(playerIds));
  }

  private createSingleGame(playerIds: number[]) {
    if (playerIds.length !== 4) {
      throw new BadRequestException('A pickleball game requires exactly 4 players.');
    }

    const uniquePlayerIds = new Set(playerIds);
    if (uniquePlayerIds.size !== 4) {
      throw new BadRequestException('Players must be unique within a game.');
    }

    const players = playerIds.map((playerId) => {
      const player = this.players.find((entry) => entry.id === playerId);

      if (!player) {
        throw new NotFoundException(`Player ${playerId} was not found.`);
      }

      return player;
    });

    const unavailablePlayer = players.find(
      (player) => !player.isReady || this.isPlayerInOngoingGame(player.id),
    );

    if (unavailablePlayer) {
      throw new BadRequestException(
        `${unavailablePlayer.name} is not eligible for a new game.`,
      );
    }

    const game: Game = {
      id: this.games.reduce((highestId, entry) => Math.max(highestId, entry.id), 0) + 1,
      status: 'ongoing',
      playerIds,
      createdAt: new Date().toISOString(),
      completedAt: null,
      score: null,
    };

    this.games.unshift(game);

    return this.toGameView(game);
  }

  completeGame(gameId: number, score: Partial<GameScore>) {
    const game = this.games.find((entry) => entry.id === gameId);

    if (!game) {
      throw new NotFoundException(`Game ${gameId} was not found.`);
    }

    if (game.status === 'completed') {
      return this.toGameView(game);
    }

    const normalizedScore = this.normalizeScore(score);

    game.status = 'completed';
    game.completedAt = new Date().toISOString();
    game.score = normalizedScore;

    return this.toGameView(game);
  }

  private buildNextGamePreview(players: PlayerQueueState[], courtCount: number) {
    return this.queueSelectionStrategy.selectNextPlayers({
      players,
      games: this.games,
      courtCount,
    });
  }

  private toGameView(game: Game) {
    const players = game.playerIds.map((playerId) => {
      const player = this.players.find((entry) => entry.id === playerId);

      if (!player) {
        throw new NotFoundException(`Player ${playerId} was not found.`);
      }

      return player;
    });

    return {
      id: game.id,
      status: game.status,
      createdAt: game.createdAt,
      completedAt: game.completedAt,
      score: game.score,
      players,
      teams: buildTeams(players),
    };
  }

  private normalizeScore(score: Partial<GameScore>) {
    const team1 = Number(score.team1);
    const team2 = Number(score.team2);

    if (!Number.isInteger(team1) || !Number.isInteger(team2) || team1 < 0 || team2 < 0) {
      throw new BadRequestException('Match scores must be whole numbers greater than or equal to 0.');
    }

    return { team1, team2 };
  }

  private toPlayerQueueState(player: Player, recentCompletedGames: Game[]): PlayerQueueState {
    return {
      ...player,
      isPlaying: this.isPlayerInOngoingGame(player.id),
      recentGamesPlayed: recentCompletedGames.filter((game) => game.playerIds.includes(player.id))
        .length,
    };
  }

  private getRecentCompletedGames() {
    return this.games
      .filter((game) => game.status === 'completed')
      .sort((left, right) => (left.completedAt! < right.completedAt! ? 1 : -1))
      .slice(0, 5);
  }

  private isPlayerInOngoingGame(playerId: number) {
    return isPlayerInOngoingGame(this.games, playerId);
  }
}
