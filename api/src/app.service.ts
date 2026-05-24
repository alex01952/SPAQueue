import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import playerSeedData from './data/players.json';
import { buildTeams } from './matching-selection';
import {
  isPlayerInOngoingGame,
  queueSelectionStrategies,
} from './queue-selection';
import {
  Game,
  GameScore,
  Player,
  PlayerQueueState,
  QueueSelectionMode,
  Round,
  TeamMatchingMode,
} from './queue.types';

const defaultRounds: Round[] = [
  {
    id: 1,
    roundNumber: 1,
    status: 'ongoing',
    createdAt: '2026-05-23T08:15:00.000Z',
    completedAt: null,
    games: [
      {
        id: 1,
        courtNumber: 1,
        status: 'ongoing',
        playerIds: [1, 2, 3, 5],
        createdAt: '2026-05-23T08:15:00.000Z',
        completedAt: null,
        score: null,
      },
    ],
  },
  {
    id: 2,
    roundNumber: 2,
    status: 'completed',
    createdAt: '2026-05-23T07:40:00.000Z',
    completedAt: '2026-05-23T08:05:00.000Z',
    games: [
      {
        id: 2,
        courtNumber: 2,
        status: 'completed',
        playerIds: [4, 6, 2, 3],
        createdAt: '2026-05-23T07:40:00.000Z',
        completedAt: '2026-05-23T08:05:00.000Z',
        score: { team1: 11, team2: 8 },
      },
    ],
  },
];

interface GameAssignmentInput {
  courtNumber: number;
  playerIds: number[];
}

@Injectable()
export class AppService {
  private readonly players: Player[] = (playerSeedData as Player[]).map((player) => ({
    ...player,
  }));
  private readonly roundsFilePath =
    process.env.MATCH_HISTORY_FILE_PATH ?? join(process.cwd(), 'src', 'data', 'rounds.json');
  private readonly rounds: Round[] = this.loadRounds();

  getQueueSnapshot(
    courtCount = 1,
    selectionMode: QueueSelectionMode = 'queue-line',
    matchingMode: TeamMatchingMode = 'dupr-balance',
  ) {
    const recentCompletedRounds = this.getRecentCompletedRounds();
    const recentCompletedGames = recentCompletedRounds.flatMap((round) => round.games);
    const completedGames = this.getAllGames().filter((game) => game.status === 'completed');
    const playerQueueStates = this.players.map((player) =>
      this.toPlayerQueueState(player, recentCompletedGames, completedGames),
    );
    const ongoingRounds = this.rounds
      .filter((round) => round.status === 'ongoing')
      .map((round) => this.toRoundView(round));
    const recentRounds = recentCompletedRounds.map((round) => this.toRoundView(round));

    return {
      players: playerQueueStates,
      ongoingRounds,
      recentRounds,
      nextGame: this.buildNextGamePreview(
        playerQueueStates,
        courtCount,
        selectionMode,
        matchingMode,
      ),
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
    return this.createRound([{ courtNumber: 1, playerIds }]);
  }

  createGames(gameAssignments: GameAssignmentInput[]) {
    if (!gameAssignments.length) {
      throw new BadRequestException('At least one game is required.');
    }

    return this.createRound(gameAssignments);
  }

  private createRound(gameAssignments: GameAssignmentInput[]) {
    const createdAt = new Date().toISOString();
    const nextGameId = this.getAllGames().reduce(
      (highestId, entry) => Math.max(highestId, entry.id),
      0,
    ) + 1;

    this.validateGameAssignments(gameAssignments);

    const games = gameAssignments.map(({ courtNumber, playerIds }, index) =>
      this.createSingleGame(playerIds, courtNumber, createdAt, nextGameId + index),
    );

    const round: Round = {
      id: this.rounds.reduce((highestId, entry) => Math.max(highestId, entry.id), 0) + 1,
      roundNumber:
        this.rounds.reduce((highestNumber, entry) => Math.max(highestNumber, entry.roundNumber), 0) +
        1,
      status: 'ongoing',
      createdAt,
      completedAt: null,
      games,
    };

    this.rounds.unshift(round);
    this.persistRounds();

    return this.toRoundView(round);
  }

  private createSingleGame(
    playerIds: number[],
    courtNumber: number,
    createdAt: string,
    gameId: number,
  ) {
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
      id: gameId,
      courtNumber,
      status: 'ongoing',
      playerIds,
      createdAt,
      completedAt: null,
      score: null,
    };

    return game;
  }

  private validateGameAssignments(gameAssignments: GameAssignmentInput[]) {
    const usedCourtNumbers = new Set<number>();

    for (const assignment of gameAssignments) {
      if (!Number.isInteger(assignment.courtNumber) || assignment.courtNumber < 1 || assignment.courtNumber > 10) {
        throw new BadRequestException('Court numbers must be whole numbers between 1 and 10.');
      }

      if (usedCourtNumbers.has(assignment.courtNumber)) {
        throw new BadRequestException('Court numbers must be unique within a batch.');
      }

      usedCourtNumbers.add(assignment.courtNumber);
    }
  }

  completeGame(gameId: number, score: Partial<GameScore>) {
    const round = this.rounds.find((entry) => entry.games.some((game) => game.id === gameId));
    const game = round?.games.find((entry) => entry.id === gameId);

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

    if (round && round.games.every((entry) => entry.status === 'completed')) {
      round.status = 'completed';
      round.completedAt = game.completedAt;
    }

    this.persistRounds();

    return this.toRoundView(round!);
  }

  private loadRounds() {
    if (!existsSync(this.roundsFilePath)) {
      this.persistRounds(defaultRounds);
      return defaultRounds.map((round) => ({
        ...round,
        games: round.games.map((game) => ({ ...game })),
      }));
    }

    const fileContents = readFileSync(this.roundsFilePath, 'utf8');
    const rounds = JSON.parse(fileContents) as Round[];

    return rounds.map((round) => ({
      ...round,
      games: round.games.map((game) => ({ ...game })),
    }));
  }

  private persistRounds(rounds = this.rounds) {
    mkdirSync(dirname(this.roundsFilePath), { recursive: true });
    writeFileSync(this.roundsFilePath, `${JSON.stringify(rounds, null, 2)}\n`, 'utf8');
  }

  private buildNextGamePreview(
    players: PlayerQueueState[],
    courtCount: number,
    selectionMode: QueueSelectionMode,
    matchingMode: TeamMatchingMode,
  ) {
    const strategy = queueSelectionStrategies[selectionMode];

    if (!strategy) {
      throw new BadRequestException(`Unsupported queue selection mode: ${selectionMode}`);
    }

    return strategy.selectNextPlayers({
      players,
      games: this.getAllGames(),
      courtCount,
      matchingMode,
    });
  }

  private toRoundView(round: Round) {
    return {
      id: round.id,
      roundNumber: round.roundNumber,
      status: round.status,
      createdAt: round.createdAt,
      completedAt: round.completedAt,
      games: round.games.map((game) => this.toGameView(game)),
    };
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
      courtNumber: game.courtNumber,
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

  private toPlayerQueueState(
    player: Player,
    recentCompletedGames: Game[],
    completedGames: Game[],
  ): PlayerQueueState {
    const lastCompletedGameAt = this.getLastCompletedGameAt(player.id, completedGames);

    return {
      ...player,
      isPlaying: this.isPlayerInOngoingGame(player.id),
      recentGamesPlayed: recentCompletedGames.filter((game) => game.playerIds.includes(player.id))
        .length,
      lastCompletedGameAt,
      queueEnteredAt: this.getQueueEnteredAt(player, lastCompletedGameAt),
    };
  }

  private getLastCompletedGameAt(playerId: number, completedGames: Game[]) {
    return completedGames.reduce<string | null>((latestCompletedAt, game) => {
      if (!game.playerIds.includes(playerId) || !game.completedAt) {
        return latestCompletedAt;
      }

      if (!latestCompletedAt || game.completedAt > latestCompletedAt) {
        return game.completedAt;
      }

      return latestCompletedAt;
    }, null);
  }

  private getQueueEnteredAt(player: Player, lastCompletedGameAt: string | null) {
    if (!player.isReady) {
      return null;
    }

    if (!player.checkedInAt) {
      return lastCompletedGameAt;
    }

    if (!lastCompletedGameAt || player.checkedInAt > lastCompletedGameAt) {
      return player.checkedInAt;
    }

    return lastCompletedGameAt;
  }

  private getRecentCompletedRounds() {
    return this.rounds
      .filter((round) => round.status === 'completed')
      .sort((left, right) => (left.completedAt! < right.completedAt! ? 1 : -1))
      .slice(0, 5);
  }

  private getAllGames() {
    return this.rounds.flatMap((round) => round.games);
  }

  private isPlayerInOngoingGame(playerId: number) {
    return isPlayerInOngoingGame(this.getAllGames(), playerId);
  }
}
