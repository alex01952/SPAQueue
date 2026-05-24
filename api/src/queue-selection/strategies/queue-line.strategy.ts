import { buildNextGamePreview } from '../queue-selection.shared';
import { QueueSelectionContext, QueueSelectionStrategy } from '../queue-selection.types';

export class QueueLineSelectionStrategy implements QueueSelectionStrategy {
  readonly name = 'queue-line';

  selectNextPlayers(context: QueueSelectionContext) {
    return buildNextGamePreview(context, this.name, (player) => player.queueEnteredAt);
  }
}
