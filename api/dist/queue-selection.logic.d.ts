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
export declare class CheckInOrderQueueSelectionStrategy implements QueueSelectionStrategy {
    readonly name = "check-in-order";
    selectNextPlayers(context: QueueSelectionContext): NextGamePreview;
}
export declare function buildCourts(players: PlayerQueueState[]): CourtAssignment[];
export declare function buildTeams(players: Player[]): Team[];
export declare function isPlayerInOngoingGame(games: Game[], playerId: number): boolean;
