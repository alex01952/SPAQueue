import { buildNextGamePreview } from '../queue-selection.shared';
import { QueueSelectionContext, QueueSelectionStrategy } from '../queue-selection.types';

export class CheckInOrderQueueSelectionStrategy implements QueueSelectionStrategy {
  readonly name = 'check-in-order';

  selectNextPlayers(context: QueueSelectionContext) {
    return buildNextGamePreview(context, this.name, (player) => player.checkedInAt);
  }
}
