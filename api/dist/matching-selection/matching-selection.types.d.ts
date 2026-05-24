import { Player, Team, TeamMatchingMode } from '../queue.types';
export interface TeamMatchingContext {
    players: Player[];
}
export interface TeamMatchingStrategy {
    name: TeamMatchingMode;
    buildTeams(context: TeamMatchingContext): Team[];
}
