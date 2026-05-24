"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCourts = buildCourts;
exports.buildTeams = buildTeams;
const matching_selection_registry_1 = require("./matching-selection.registry");
function buildCourts(players, matchingMode = 'dupr-balance') {
    const courts = [];
    for (let index = 0; index < players.length; index += 4) {
        const courtPlayers = players.slice(index, index + 4);
        if (courtPlayers.length < 4) {
            break;
        }
        courts.push({
            courtNumber: courts.length + 1,
            players: courtPlayers,
            teams: buildTeams(courtPlayers, matchingMode),
        });
    }
    return courts;
}
function buildTeams(players, matchingMode = 'dupr-balance') {
    const strategy = matching_selection_registry_1.teamMatchingStrategies[matchingMode];
    if (!strategy) {
        throw new Error(`Unsupported team matching mode: ${matchingMode}`);
    }
    return strategy.buildTeams({ players });
}
//# sourceMappingURL=matching-selection.shared.js.map