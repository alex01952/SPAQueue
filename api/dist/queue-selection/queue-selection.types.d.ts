import { Game, NextGamePreview, PlayerQueueState, TeamMatchingMode } from '../queue.types';
export interface QueueSelectionContext {
    players: PlayerQueueState[];
    games: Game[];
    courtCount: number;
    matchingMode: TeamMatchingMode;
}
export interface QueueSelectionStrategy {
    name: string;
    selectNextPlayers(context: QueueSelectionContext): NextGamePreview;
}
