import { NextGamePreview } from '../../queue.types';
import { QueueSelectionContext, QueueSelectionStrategy } from '../queue-selection.types';
export declare class LeastPlayedFirstQueueSelectionStrategy implements QueueSelectionStrategy {
    readonly name = "least-played-first";
    selectNextPlayers(context: QueueSelectionContext): NextGamePreview;
}
