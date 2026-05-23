import { GameScore, Player, PlayerQueueState } from './queue.types';
export declare class AppService {
    private readonly players;
    private readonly queueSelectionStrategy;
    private readonly games;
    getQueueSnapshot(courtCount?: number): {
        players: PlayerQueueState[];
        ongoingGames: {
            id: number;
            status: import("./queue.types").GameStatus;
            createdAt: string;
            completedAt: string | null;
            score: GameScore | null;
            players: Player[];
            teams: import("./queue.types").Team[];
        }[];
        recentGames: {
            id: number;
            status: import("./queue.types").GameStatus;
            createdAt: string;
            completedAt: string | null;
            score: GameScore | null;
            players: Player[];
            teams: import("./queue.types").Team[];
        }[];
        nextGame: import("./queue.types").NextGamePreview;
    };
    updatePlayerReadyState(playerId: number, isReady: boolean): {
        isPlaying: boolean;
        id: number;
        name: string;
        dupr: number | null;
        isReady: boolean;
        checkedInAt: string | null;
    };
    createGame(playerIds: number[]): {
        id: number;
        status: import("./queue.types").GameStatus;
        createdAt: string;
        completedAt: string | null;
        score: GameScore | null;
        players: Player[];
        teams: import("./queue.types").Team[];
    };
    createGames(playerGroups: number[][]): {
        id: number;
        status: import("./queue.types").GameStatus;
        createdAt: string;
        completedAt: string | null;
        score: GameScore | null;
        players: Player[];
        teams: import("./queue.types").Team[];
    }[];
    private createSingleGame;
    completeGame(gameId: number, score: Partial<GameScore>): {
        id: number;
        status: import("./queue.types").GameStatus;
        createdAt: string;
        completedAt: string | null;
        score: GameScore | null;
        players: Player[];
        teams: import("./queue.types").Team[];
    };
    private buildNextGamePreview;
    private toGameView;
    private normalizeScore;
    private toPlayerQueueState;
    private getRecentCompletedGames;
    private isPlayerInOngoingGame;
}
