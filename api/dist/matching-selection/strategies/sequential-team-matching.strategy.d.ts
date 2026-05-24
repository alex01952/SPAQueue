import { TeamMatchingStrategy } from '../matching-selection.types';
export declare class SequentialTeamMatchingStrategy implements TeamMatchingStrategy {
    readonly name = "sequential";
    buildTeams({ players }: {
        players: Parameters<TeamMatchingStrategy['buildTeams']>[0]['players'];
    }): {
        name: string;
        players: import("../../queue.types").Player[];
    }[];
}
