"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.teamMatchingStrategies = void 0;
const dupr_rating_matching_strategy_1 = require("./strategies/dupr-rating-matching-strategy");
const sequential_team_matching_strategy_1 = require("./strategies/sequential-team-matching.strategy");
const skill_rating_matching_strategy_1 = require("./strategies/skill-rating-matching-strategy");
exports.teamMatchingStrategies = {
    'dupr-balance': new dupr_rating_matching_strategy_1.DuprRatingMatchingStrategy(),
    sequential: new sequential_team_matching_strategy_1.SequentialTeamMatchingStrategy(),
    'skill-balance': new skill_rating_matching_strategy_1.SkillRatingMatchingStrategy(),
};
//# sourceMappingURL=matching-selection.registry.js.map