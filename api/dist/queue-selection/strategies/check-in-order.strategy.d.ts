import { QueueSelectionContext, QueueSelectionStrategy } from '../queue-selection.types';
export declare class CheckInOrderQueueSelectionStrategy implements QueueSelectionStrategy {
    readonly name = "check-in-order";
    selectNextPlayers(context: QueueSelectionContext): import("../../queue.types").NextGamePreview;
}
