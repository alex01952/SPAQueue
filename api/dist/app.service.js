"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppService = void 0;
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const players_json_1 = __importDefault(require("./data/players.json"));
const matching_selection_1 = require("./matching-selection");
const queue_selection_1 = require("./queue-selection");
const defaultRounds = [
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
let AppService = class AppService {
    players = players_json_1.default.map((player) => ({
        ...player,
    }));
    roundsFilePath = process.env.MATCH_HISTORY_FILE_PATH ?? (0, node_path_1.join)(process.cwd(), 'src', 'data', 'rounds.json');
    rounds = this.loadRounds();
    getQueueSnapshot(courtCount = 1, selectionMode = 'queue-line', matchingMode = 'dupr-balance') {
        const recentCompletedRounds = this.getRecentCompletedRounds();
        const recentCompletedGames = recentCompletedRounds.flatMap((round) => round.games);
        const completedGames = this.getAllGames().filter((game) => game.status === 'completed');
        const playerQueueStates = this.players.map((player) => this.toPlayerQueueState(player, recentCompletedGames, completedGames));
        const ongoingRounds = this.rounds
            .filter((round) => round.status === 'ongoing')
            .map((round) => this.toRoundView(round));
        const recentRounds = recentCompletedRounds.map((round) => this.toRoundView(round));
        return {
            players: playerQueueStates,
            ongoingRounds,
            recentRounds,
            nextGame: this.buildNextGamePreview(playerQueueStates, courtCount, selectionMode, matchingMode),
        };
    }
    updatePlayerReadyState(playerId, isReady) {
        const player = this.players.find((entry) => entry.id === playerId);
        if (!player) {
            throw new common_1.NotFoundException(`Player ${playerId} was not found.`);
        }
        player.isReady = isReady;
        player.checkedInAt = isReady ? new Date().toISOString() : null;
        return {
            ...player,
            isPlaying: this.isPlayerInOngoingGame(player.id),
        };
    }
    createGame(playerIds) {
        return this.createRound([{ courtNumber: 1, playerIds }]);
    }
    createGames(gameAssignments) {
        if (!gameAssignments.length) {
            throw new common_1.BadRequestException('At least one game is required.');
        }
        return this.createRound(gameAssignments);
    }
    createRound(gameAssignments) {
        const createdAt = new Date().toISOString();
        const nextGameId = this.getAllGames().reduce((highestId, entry) => Math.max(highestId, entry.id), 0) + 1;
        this.validateGameAssignments(gameAssignments);
        const games = gameAssignments.map(({ courtNumber, playerIds }, index) => this.createSingleGame(playerIds, courtNumber, createdAt, nextGameId + index));
        const round = {
            id: this.rounds.reduce((highestId, entry) => Math.max(highestId, entry.id), 0) + 1,
            roundNumber: this.rounds.reduce((highestNumber, entry) => Math.max(highestNumber, entry.roundNumber), 0) +
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
    createSingleGame(playerIds, courtNumber, createdAt, gameId) {
        if (playerIds.length !== 4) {
            throw new common_1.BadRequestException('A pickleball game requires exactly 4 players.');
        }
        const uniquePlayerIds = new Set(playerIds);
        if (uniquePlayerIds.size !== 4) {
            throw new common_1.BadRequestException('Players must be unique within a game.');
        }
        const players = playerIds.map((playerId) => {
            const player = this.players.find((entry) => entry.id === playerId);
            if (!player) {
                throw new common_1.NotFoundException(`Player ${playerId} was not found.`);
            }
            return player;
        });
        const unavailablePlayer = players.find((player) => !player.isReady || this.isPlayerInOngoingGame(player.id));
        if (unavailablePlayer) {
            throw new common_1.BadRequestException(`${unavailablePlayer.name} is not eligible for a new game.`);
        }
        const game = {
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
    validateGameAssignments(gameAssignments) {
        const usedCourtNumbers = new Set();
        for (const assignment of gameAssignments) {
            if (!Number.isInteger(assignment.courtNumber) || assignment.courtNumber < 1 || assignment.courtNumber > 10) {
                throw new common_1.BadRequestException('Court numbers must be whole numbers between 1 and 10.');
            }
            if (usedCourtNumbers.has(assignment.courtNumber)) {
                throw new common_1.BadRequestException('Court numbers must be unique within a batch.');
            }
            usedCourtNumbers.add(assignment.courtNumber);
        }
    }
    completeGame(gameId, score) {
        const round = this.rounds.find((entry) => entry.games.some((game) => game.id === gameId));
        const game = round?.games.find((entry) => entry.id === gameId);
        if (!game) {
            throw new common_1.NotFoundException(`Game ${gameId} was not found.`);
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
        return this.toRoundView(round);
    }
    loadRounds() {
        if (!(0, node_fs_1.existsSync)(this.roundsFilePath)) {
            this.persistRounds(defaultRounds);
            return defaultRounds.map((round) => ({
                ...round,
                games: round.games.map((game) => ({ ...game })),
            }));
        }
        const fileContents = (0, node_fs_1.readFileSync)(this.roundsFilePath, 'utf8');
        const rounds = JSON.parse(fileContents);
        return rounds.map((round) => ({
            ...round,
            games: round.games.map((game) => ({ ...game })),
        }));
    }
    persistRounds(rounds = this.rounds) {
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(this.roundsFilePath), { recursive: true });
        (0, node_fs_1.writeFileSync)(this.roundsFilePath, `${JSON.stringify(rounds, null, 2)}\n`, 'utf8');
    }
    buildNextGamePreview(players, courtCount, selectionMode, matchingMode) {
        const strategy = queue_selection_1.queueSelectionStrategies[selectionMode];
        if (!strategy) {
            throw new common_1.BadRequestException(`Unsupported queue selection mode: ${selectionMode}`);
        }
        return strategy.selectNextPlayers({
            players,
            games: this.getAllGames(),
            courtCount,
            matchingMode,
        });
    }
    toRoundView(round) {
        return {
            id: round.id,
            roundNumber: round.roundNumber,
            status: round.status,
            createdAt: round.createdAt,
            completedAt: round.completedAt,
            games: round.games.map((game) => this.toGameView(game)),
        };
    }
    toGameView(game) {
        const players = game.playerIds.map((playerId) => {
            const player = this.players.find((entry) => entry.id === playerId);
            if (!player) {
                throw new common_1.NotFoundException(`Player ${playerId} was not found.`);
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
            teams: (0, matching_selection_1.buildTeams)(players),
        };
    }
    normalizeScore(score) {
        const team1 = Number(score.team1);
        const team2 = Number(score.team2);
        if (!Number.isInteger(team1) || !Number.isInteger(team2) || team1 < 0 || team2 < 0) {
            throw new common_1.BadRequestException('Match scores must be whole numbers greater than or equal to 0.');
        }
        return { team1, team2 };
    }
    toPlayerQueueState(player, recentCompletedGames, completedGames) {
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
    getLastCompletedGameAt(playerId, completedGames) {
        return completedGames.reduce((latestCompletedAt, game) => {
            if (!game.playerIds.includes(playerId) || !game.completedAt) {
                return latestCompletedAt;
            }
            if (!latestCompletedAt || game.completedAt > latestCompletedAt) {
                return game.completedAt;
            }
            return latestCompletedAt;
        }, null);
    }
    getQueueEnteredAt(player, lastCompletedGameAt) {
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
    getRecentCompletedRounds() {
        return this.rounds
            .filter((round) => round.status === 'completed')
            .sort((left, right) => (left.completedAt < right.completedAt ? 1 : -1))
            .slice(0, 5);
    }
    getAllGames() {
        return this.rounds.flatMap((round) => round.games);
    }
    isPlayerInOngoingGame(playerId) {
        return (0, queue_selection_1.isPlayerInOngoingGame)(this.getAllGames(), playerId);
    }
};
exports.AppService = AppService;
exports.AppService = AppService = __decorate([
    (0, common_1.Injectable)()
], AppService);
//# sourceMappingURL=app.service.js.map