import { QueueSelectionMode } from '../queue.types';
import { CheckInOrderQueueSelectionStrategy } from './strategies/check-in-order.strategy';
import { LeastPlayedFirstQueueSelectionStrategy } from './strategies/least-played-first.strategy';
import { QueueLineSelectionStrategy } from './strategies/queue-line.strategy';
import { QueueSelectionStrategy } from './queue-selection.types';

export const queueSelectionStrategies: Record<QueueSelectionMode, QueueSelectionStrategy> = {
  'check-in-order': new CheckInOrderQueueSelectionStrategy(),
  'least-played-first': new LeastPlayedFirstQueueSelectionStrategy(),
  'queue-line': new QueueLineSelectionStrategy(),
};
