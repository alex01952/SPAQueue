"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueLineSelectionStrategy = exports.LeastPlayedFirstQueueSelectionStrategy = exports.CheckInOrderQueueSelectionStrategy = exports.isPlayerInOngoingGame = exports.queueSelectionStrategies = void 0;
var queue_selection_registry_1 = require("./queue-selection.registry");
Object.defineProperty(exports, "queueSelectionStrategies", { enumerable: true, get: function () { return queue_selection_registry_1.queueSelectionStrategies; } });
var queue_selection_utils_1 = require("./queue-selection.utils");
Object.defineProperty(exports, "isPlayerInOngoingGame", { enumerable: true, get: function () { return queue_selection_utils_1.isPlayerInOngoingGame; } });
var check_in_order_strategy_1 = require("./strategies/check-in-order.strategy");
Object.defineProperty(exports, "CheckInOrderQueueSelectionStrategy", { enumerable: true, get: function () { return check_in_order_strategy_1.CheckInOrderQueueSelectionStrategy; } });
var least_played_first_strategy_1 = require("./strategies/least-played-first.strategy");
Object.defineProperty(exports, "LeastPlayedFirstQueueSelectionStrategy", { enumerable: true, get: function () { return least_played_first_strategy_1.LeastPlayedFirstQueueSelectionStrategy; } });
var queue_line_strategy_1 = require("./strategies/queue-line.strategy");
Object.defineProperty(exports, "QueueLineSelectionStrategy", { enumerable: true, get: function () { return queue_line_strategy_1.QueueLineSelectionStrategy; } });
//# sourceMappingURL=index.js.map