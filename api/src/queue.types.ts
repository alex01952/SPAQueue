export type GameStatus = 'ongoing' | 'completed';
export type QueueSelectionMode = 'check-in-order' | 'queue-line' | 'least-played-first';
export type TeamMatchingMode = 'sequential' | 'dupr-balance' | 'skill-balance';
export type SkillLevel =
  | 'N/A'
  | 'Beginner'
  | 'Novice'
  | 'Intermediate'
  | 'High Intermediate'
  | 'Advanced';

export interface Player {
  id: number;
  name: string;
  dupr: number | null;
  gender?: string | null;
  skillLevel: SkillLevel;
  isReady: boolean;
  checkedInAt: string | null;
}

export interface PlayerQueueState extends Player {
  isPlaying: boolean;
  recentGamesPlayed: number;
  lastCompletedGameAt: string | null;
  queueEnteredAt: string | null;
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
  courtNumber: number;
  status: GameStatus;
  playerIds: number[];
  createdAt: string;
  completedAt: string | null;
  score: GameScore | null;
}

export interface Round {
  id: number;
  roundNumber: number;
  status: GameStatus;
  createdAt: string;
  completedAt: string | null;
  games: Game[];
}

export interface NextGamePreview {
  courtCount: number;
  selectionMode: QueueSelectionMode;
  matchingMode: TeamMatchingMode;
  eligiblePlayers: PlayerQueueState[];
  selectedPlayers: PlayerQueueState[];
  courts: CourtAssignment[];
}