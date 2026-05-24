"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueLineSelectionStrategy = void 0;
const queue_selection_shared_1 = require("../queue-selection.shared");
class QueueLineSelectionStrategy {
    name = 'queue-line';
    selectNextPlayers(context) {
        return (0, queue_selection_shared_1.buildNextGamePreview)(context, this.name, (player) => player.queueEnteredAt);
    }
}
exports.QueueLineSelectionStrategy = QueueLineSelectionStrategy;
//# sourceMappingURL=queue-line.strategy.js.map