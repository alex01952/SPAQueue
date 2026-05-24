"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNextGamePreview = buildNextGamePreview;
const matching_selection_1 = require("../matching-selection");
const queue_selection_utils_1 = require("./queue-selection.utils");
function buildNextGamePreview(context, selectionMode, getQueueTimestamp) {
    const courtCount = Math.max(1, Math.floor(context.courtCount || 1));
    const eligiblePlayers = context.players
        .filter((player) => player.isReady && !(0, queue_selection_utils_1.isPlayerInOngoingGame)(context.games, player.id))
        .sort((left, right) => comparePlayers(left, right, getQueueTimestamp));
    const selectedPlayers = eligiblePlayers.slice(0, courtCount * 4);
    return {
        courtCount,
        selectionMode,
        matchingMode: context.matchingMode,
        eligiblePlayers,
        selectedPlayers,
        courts: (0, matching_selection_1.buildCourts)(selectedPlayers, context.matchingMode),
    };
}
function comparePlayers(left, right, getQueueTimestamp) {
    const queueComparison = compareTimestamps(getQueueTimestamp(left), getQueueTimestamp(right));
    if (queueComparison !== 0) {
        return queueComparison;
    }
    const checkInComparison = compareTimestamps(left.checkedInAt, right.checkedInAt);
    if (checkInComparison !== 0) {
        return checkInComparison;
    }
    return left.name.localeCompare(right.name);
}
function compareTimestamps(left, right) {
    if (left && right) {
        return left.localeCompare(right);
    }
    if (left) {
        return -1;
    }
    if (right) {
        return 1;
    }
    return 0;
}
//# sourceMappingURL=queue-selection.shared.js.map