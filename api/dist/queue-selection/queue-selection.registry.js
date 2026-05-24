"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueSelectionStrategies = void 0;
const check_in_order_strategy_1 = require("./strategies/check-in-order.strategy");
const least_played_first_strategy_1 = require("./strategies/least-played-first.strategy");
const queue_line_strategy_1 = require("./strategies/queue-line.strategy");
exports.queueSelectionStrategies = {
    'check-in-order': new check_in_order_strategy_1.CheckInOrderQueueSelectionStrategy(),
    'least-played-first': new least_played_first_strategy_1.LeastPlayedFirstQueueSelectionStrategy(),
    'queue-line': new queue_line_strategy_1.QueueLineSelectionStrategy(),
};
//# sourceMappingURL=queue-selection.registry.js.map