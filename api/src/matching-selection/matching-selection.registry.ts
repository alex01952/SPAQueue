import { TeamMatchingMode } from '../queue.types';
import { TeamMatchingStrategy } from './matching-selection.types';
import { DuprRatingMatchingStrategy } from './strategies/dupr-rating-matching-strategy';
import { SequentialTeamMatchingStrategy } from './strategies/sequential-team-matching.strategy';
import { SkillRatingMatchingStrategy } from './strategies/skill-rating-matching-strategy';

export const teamMatchingStrategies: Record<TeamMatchingMode, TeamMatchingStrategy> = {
  'dupr-balance': new DuprRatingMatchingStrategy(),
  sequential: new SequentialTeamMatchingStrategy(),
  'skill-balance': new SkillRatingMatchingStrategy(),
};