"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeastPlayedFirstQueueSelectionStrategy = void 0;
const matching_selection_1 = require("../../matching-selection");
const queue_selection_utils_1 = require("../queue-selection.utils");
class LeastPlayedFirstQueueSelectionStrategy {
    name = 'least-played-first';
    selectNextPlayers(context) {
        const courtCount = Math.max(1, Math.floor(context.courtCount || 1));
        const eligiblePlayers = context.players
            .filter((player) => player.isReady && !(0, queue_selection_utils_1.isPlayerInOngoingGame)(context.games, player.id))
            .sort(comparePlayersByRecentGames);
        const selectedPlayers = eligiblePlayers.slice(0, courtCount * 4);
        return {
            courtCount,
            selectionMode: this.name,
            matchingMode: context.matchingMode,
            eligiblePlayers,
            selectedPlayers,
            courts: (0, matching_selection_1.buildCourts)(selectedPlayers, context.matchingMode),
        };
    }
}
exports.LeastPlayedFirstQueueSelectionStrategy = LeastPlayedFirstQueueSelectionStrategy;
function comparePlayersByRecentGames(left, right) {
    const recentGamesComparison = left.recentGamesPlayed - right.recentGamesPlayed;
    if (recentGamesComparison !== 0) {
        return recentGamesComparison;
    }
    const queueComparison = compareTimestamps(left.queueEnteredAt, right.queueEnteredAt);
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
//# sourceMappingURL=least-played-first.strategy.js.map