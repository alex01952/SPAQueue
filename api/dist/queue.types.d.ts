export type GameStatus = 'ongoing' | 'completed';
export interface Player {
    id: number;
    name: string;
    dupr: number | null;
    isReady: boolean;
    checkedInAt: string | null;
}
export interface PlayerQueueState extends Player {
    isPlaying: boolean;
    recentGamesPlayed: number;
}
export interface Team {
    name: string;
    players: Player[];
}
export interface CourtAssignment {
    courtNumber: number;
    players: PlayerQueueState[];
    teams: Team[];
}
export interface GameScore {
    team1: number;
    team2: number;
}
export interface Game {
    id: number;
    status: GameStatus;
    playerIds: number[];
    createdAt: string;
    completedAt: string | null;
    score: GameScore | null;
}
export interface NextGamePreview {
    courtCount: number;
    eligiblePlayers: PlayerQueueState[];
    selectedPlayers: PlayerQueueState[];
    courts: CourtAssignment[];
}
