import { GameScore, Player, PlayerQueueState, QueueSelectionMode, TeamMatchingMode } from './queue.types';
interface GameAssignmentInput {
    courtNumber: number;
    playerIds: number[];
}
export declare class AppService {
    private readonly players;
    private readonly roundsFilePath;
    private readonly rounds;
    getQueueSnapshot(courtCount?: number, selectionMode?: QueueSelectionMode, matchingMode?: TeamMatchingMode): {
        players: PlayerQueueState[];
        ongoingRounds: {
            id: number;
            roundNumber: number;
            status: import("./queue.types").GameStatus;
            createdAt: string;
            completedAt: string | null;
            games: {
                id: number;
                courtNumber: number;
                status: import("./queue.types").GameStatus;
                createdAt: string;
                completedAt: string | null;
                score: GameScore | null;
                players: Player[];
                teams: import("./queue.types").Team[];
            }[];
        }[];
        recentRounds: {
            id: number;
            roundNumber: number;
            status: import("./queue.types").GameStatus;
            createdAt: string;
            completedAt: string | null;
            games: {
                id: number;
                courtNumber: number;
                status: import("./queue.types").GameStatus;
                createdAt: string;
                completedAt: string | null;
                score: GameScore | null;
                players: Player[];
                teams: import("./queue.types").Team[];
            }[];
        }[];
        nextGame: import("./queue.types").NextGamePreview;
    };
    updatePlayerReadyState(playerId: number, isReady: boolean): {
        isPlaying: boolean;
        id: number;
        name: string;
        dupr: number | null;
        gender?: string | null;
        skillLevel: import("./queue.types").SkillLevel;
        isReady: boolean;
        checkedInAt: string | null;
    };
    createGame(playerIds: number[]): {
        id: number;
        roundNumber: number;
        status: import("./queue.types").GameStatus;
        createdAt: string;
        completedAt: string | null;
        games: {
            id: number;
            courtNumber: number;
            status: import("./queue.types").GameStatus;
            createdAt: string;
            completedAt: string | null;
            score: GameScore | null;
            players: Player[];
            teams: import("./queue.types").Team[];
        }[];
    };
    createGames(gameAssignments: GameAssignmentInput[]): {
        id: number;
        roundNumber: number;
        status: import("./queue.types").GameStatus;
        createdAt: string;
        completedAt: string | null;
        games: {
            id: number;
            courtNumber: number;
            status: import("./queue.types").GameStatus;
            createdAt: string;
            completedAt: string | null;
            score: GameScore | null;
            players: Player[];
            teams: import("./queue.types").Team[];
        }[];
    };
    private createRound;
    private createSingleGame;
    private validateGameAssignments;
    completeGame(gameId: number, score: Partial<GameScore>): {
        id: number;
        courtNumber: number;
        status: import("./queue.types").GameStatus;
        createdAt: string;
        completedAt: string | null;
        score: GameScore | null;
        players: Player[];
        teams: import("./queue.types").Team[];
    } | {
        id: number;
        roundNumber: number;
        status: import("./queue.types").GameStatus;
        createdAt: string;
        completedAt: string | null;
        games: {
            id: number;
            courtNumber: number;
            status: import("./queue.types").GameStatus;
            createdAt: string;
            completedAt: string | null;
            score: GameScore | null;
            players: Player[];
            teams: import("./queue.types").Team[];
        }[];
    };
    private loadRounds;
    private persistRounds;
    private buildNextGamePreview;
    private toRoundView;
    private toGameView;
    private normalizeScore;
    private toPlayerQueueState;
    private getLastCompletedGameAt;
    private getQueueEnteredAt;
    private getRecentCompletedRounds;
    private getAllGames;
    private isPlayerInOngoingGame;
}
export {};
