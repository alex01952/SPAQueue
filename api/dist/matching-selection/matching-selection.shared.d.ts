import { CourtAssignment, Player, PlayerQueueState, TeamMatchingMode } from '../queue.types';
export declare function buildCourts(players: PlayerQueueState[], matchingMode?: TeamMatchingMode): CourtAssignment[];
export declare function buildTeams(players: Player[], matchingMode?: TeamMatchingMode): import("../queue.types").Team[];
