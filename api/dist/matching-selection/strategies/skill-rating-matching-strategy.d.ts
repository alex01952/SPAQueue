import { Team } from '../../queue.types';
import { TeamMatchingStrategy } from '../matching-selection.types';
type TeamPairing = [Team, Team];
export declare class SkillRatingMatchingStrategy implements TeamMatchingStrategy {
    readonly name = "skill-balance";
    buildTeams({ players }: {
        players: Parameters<TeamMatchingStrategy['buildTeams']>[0]['players'];
    }): never[] | TeamPairing;
}
export {};
