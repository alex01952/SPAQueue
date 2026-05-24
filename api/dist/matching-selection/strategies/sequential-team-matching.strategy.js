"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequentialTeamMatchingStrategy = void 0;
class SequentialTeamMatchingStrategy {
    name = 'sequential';
    buildTeams({ players }) {
        if (players.length !== 4) {
            return [];
        }
        return [
            {
                name: 'Team 1',
                players: players.slice(0, 2),
            },
            {
                name: 'Team 2',
                players: players.slice(2, 4),
            },
        ];
    }
}
exports.SequentialTeamMatchingStrategy = SequentialTeamMatchingStrategy;
//# sourceMappingURL=sequential-team-matching.strategy.js.map