import { Team } from '../../queue.types';
import { TeamMatchingStrategy } from '../matching-selection.types';
type TeamPairing = [Team, Team];
export declare class DuprRatingMatchingStrategy implements TeamMatchingStrategy {
    readonly name = "dupr-balance";
    buildTeams({ players }: {
        players: Parameters<TeamMatchingStrategy['buildTeams']>[0]['players'];
    }): TeamPairing | never[];
}
export {};
