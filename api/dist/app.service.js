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
const players_json_1 = __importDefault(require("./data/players.json"));
const queue_selection_logic_1 = require("./queue-selection.logic");
let AppService = class AppService {
    players = players_json_1.default.map((player) => ({
        ...player,
    }));
    queueSelectionStrategy = new queue_selection_logic_1.CheckInOrderQueueSelectionStrategy();
    games = [
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
        const playerQueueStates = this.players.map((player) => this.toPlayerQueueState(player, recentCompletedGames));
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
        return this.createSingleGame(playerIds);
    }
    createGames(playerGroups) {
        if (!playerGroups.length) {
            throw new common_1.BadRequestException('At least one game is required.');
        }
        return playerGroups.map((playerIds) => this.createSingleGame(playerIds));
    }
    createSingleGame(playerIds) {
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
    completeGame(gameId, score) {
        const game = this.games.find((entry) => entry.id === gameId);
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
        return this.toGameView(game);
    }
    buildNextGamePreview(players, courtCount) {
        return this.queueSelectionStrategy.selectNextPlayers({
            players,
            games: this.games,
            courtCount,
        });
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
            status: game.status,
            createdAt: game.createdAt,
            completedAt: game.completedAt,
            score: game.score,
            players,
            teams: (0, queue_selection_logic_1.buildTeams)(players),
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
    toPlayerQueueState(player, recentCompletedGames) {
        return {
            ...player,
            isPlaying: this.isPlayerInOngoingGame(player.id),
            recentGamesPlayed: recentCompletedGames.filter((game) => game.playerIds.includes(player.id))
                .length,
        };
    }
    getRecentCompletedGames() {
        return this.games
            .filter((game) => game.status === 'completed')
            .sort((left, right) => (left.completedAt < right.completedAt ? 1 : -1))
            .slice(0, 5);
    }
    isPlayerInOngoingGame(playerId) {
        return (0, queue_selection_logic_1.isPlayerInOngoingGame)(this.games, playerId);
    }
};
exports.AppService = AppService;
exports.AppService = AppService = __decorate([
    (0, common_1.Injectable)()
], AppService);
//# sourceMappingURL=app.service.js.map