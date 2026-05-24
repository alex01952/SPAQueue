"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DuprRatingMatchingStrategy = void 0;
class DuprRatingMatchingStrategy {
    name = 'dupr-balance';
    buildTeams({ players }) {
        if (players.length !== 4) {
            return [];
        }
        const pairings = buildPairings(players);
        return pairings.reduce((bestPairing, currentPairing) => {
            if (!bestPairing) {
                return currentPairing;
            }
            return comparePairings(currentPairing, bestPairing) < 0 ? currentPairing : bestPairing;
        }, null) ?? [];
    }
}
exports.DuprRatingMatchingStrategy = DuprRatingMatchingStrategy;
function buildPairings(players) {
    return [
        [
            createTeam('Team 1', [players[0], players[1]]),
            createTeam('Team 2', [players[2], players[3]]),
        ],
        [
            createTeam('Team 1', [players[0], players[2]]),
            createTeam('Team 2', [players[1], players[3]]),
        ],
        [
            createTeam('Team 1', [players[0], players[3]]),
            createTeam('Team 2', [players[1], players[2]]),
        ],
    ];
}
function createTeam(name, players) {
    return {
        name,
        players,
    };
}
function comparePairings(left, right) {
    const differenceComparison = getRatingDifference(left) - getRatingDifference(right);
    if (differenceComparison !== 0) {
        return differenceComparison;
    }
    const strongerTeamComparison = getStrongerTeamRating(left) - getStrongerTeamRating(right);
    if (strongerTeamComparison !== 0) {
        return strongerTeamComparison;
    }
    return getPairingSignature(left).localeCompare(getPairingSignature(right));
}
function getRatingDifference(pairing) {
    const [firstTeam, secondTeam] = pairing;
    return Math.abs(getTeamRating(firstTeam) - getTeamRating(secondTeam));
}
function getStrongerTeamRating(pairing) {
    return Math.max(...pairing.map(getTeamRating));
}
function getTeamRating(team) {
    return team.players.reduce((total, player) => total + (player.dupr ?? 3.0), 0);
}
function getPairingSignature(pairing) {
    return pairing
        .map((team) => team.players.map((player) => player.id).sort((left, right) => left - right).join('-'))
        .sort()
        .join('|');
}
//# sourceMappingURL=dupr-rating-matching-strategy.js.map