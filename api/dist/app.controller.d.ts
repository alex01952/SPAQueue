import { AppService } from './app.service';
import { GameScore } from './queue.types';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getQueueSnapshot(courtCount: number): {
        players: import("./queue.types").PlayerQueueState[];
        ongoingGames: {
            id: number;
            status: import("./queue.types").GameStatus;
            createdAt: string;
            completedAt: string | null;
            score: GameScore | null;
            players: import("./queue.types").Player[];
            teams: import("./queue.types").Team[];
        }[];
        recentGames: {
            id: number;
            status: import("./queue.types").GameStatus;
            createdAt: string;
            completedAt: string | null;
            score: GameScore | null;
            players: import("./queue.types").Player[];
            teams: import("./queue.types").Team[];
        }[];
        nextGame: import("./queue.types").NextGamePreview;
    };
    updatePlayerReadyState(id: number, isReady: boolean): {
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
        players: import("./queue.types").Player[];
        teams: import("./queue.types").Team[];
    };
    createGames(playerGroups: number[][]): {
        id: number;
        status: import("./queue.types").GameStatus;
        createdAt: string;
        completedAt: string | null;
        score: GameScore | null;
        players: import("./queue.types").Player[];
        teams: import("./queue.types").Team[];
    }[];
    completeGame(id: number, score: Partial<GameScore>): {
        id: number;
        status: import("./queue.types").GameStatus;
        createdAt: string;
        completedAt: string | null;
        score: GameScore | null;
        players: import("./queue.types").Player[];
        teams: import("./queue.types").Team[];
    };
}
