"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckInOrderQueueSelectionStrategy = void 0;
const queue_selection_shared_1 = require("../queue-selection.shared");
class CheckInOrderQueueSelectionStrategy {
    name = 'check-in-order';
    selectNextPlayers(context) {
        return (0, queue_selection_shared_1.buildNextGamePreview)(context, this.name, (player) => player.checkedInAt);
    }
}
exports.CheckInOrderQueueSelectionStrategy = CheckInOrderQueueSelectionStrategy;
//# sourceMappingURL=check-in-order.strategy.js.map