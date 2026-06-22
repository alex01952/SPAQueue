import { AppService } from './app.service';
import type { ImportParticipantsResult, MonthlyParticipationSummary } from './app.service';
import { GameScore } from './queue.types';
import type { QueueSelectionMode, TeamMatchingMode } from './queue.types';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getMonthlyParticipationSummary(): Promise<MonthlyParticipationSummary[]>;
    getQueueSnapshot(courtCount: number, selectionMode: QueueSelectionMode, matchingMode: TeamMatchingMode): {
        players: import("./queue.types").PlayerQueueState[];
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
                players: import("./queue.types").Player[];
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
                players: import("./queue.types").Player[];
                teams: import("./queue.types").Team[];
            }[];
        }[];
        nextGame: import("./queue.types").NextGamePreview;
    };
    updatePlayerReadyState(id: number, isReady: boolean): {
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
            players: import("./queue.types").Player[];
            teams: import("./queue.types").Team[];
        }[];
    };
    createGames(gameAssignments?: Array<{
        courtNumber: number;
        playerIds: number[];
    }>, playerGroups?: number[][]): {
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
            players: import("./queue.types").Player[];
            teams: import("./queue.types").Team[];
        }[];
    };
    importParticipantsFromText(sourceText?: string): Promise<ImportParticipantsResult>;
    completeGame(id: number, score: Partial<GameScore>): {
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
            players: import("./queue.types").Player[];
            teams: import("./queue.types").Team[];
        }[];
    } | {
        id: number;
        courtNumber: number;
        status: import("./queue.types").GameStatus;
        createdAt: string;
        completedAt: string | null;
        score: GameScore | null;
        players: import("./queue.types").Player[];
        teams: import("./queue.types").Team[];
    };
}
