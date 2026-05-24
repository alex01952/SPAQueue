import { NextGamePreview, PlayerQueueState, QueueSelectionMode } from '../queue.types';
import { QueueSelectionContext } from './queue-selection.types';
export declare function buildNextGamePreview(context: QueueSelectionContext, selectionMode: QueueSelectionMode, getQueueTimestamp: (player: PlayerQueueState) => string | null): NextGamePreview;
