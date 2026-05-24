import { QueueSelectionContext, QueueSelectionStrategy } from '../queue-selection.types';
export declare class QueueLineSelectionStrategy implements QueueSelectionStrategy {
    readonly name = "queue-line";
    selectNextPlayers(context: QueueSelectionContext): import("../../queue.types").NextGamePreview;
}
