export const tournamentCategories = [
  'Mens Doubles',
  'Womens Doubles',
  'Mixed Doubles',
  'Team Tournament',
] as const;

export const tournamentLevels = [
  'Beginner',
  'Novice',
  'Low Intermediate',
  'Intermediate',
  'High Intermediate',
  'Advanced',
] as const;

export type TournamentCategory = (typeof tournamentCategories)[number];
export type TournamentLevel = (typeof tournamentLevels)[number];

export interface TournamentExperienceDetails {
  hasJoinedTournaments: boolean;
  highestTournamentLevel?: TournamentLevel;
  hasWonTournaments: boolean;
  highestWinningLevel?: TournamentLevel;
  winsOrPodiums?: number;
}

export interface Tournament {
  tournamentId: string;
  name: string;
  category: TournamentCategory;
  level: TournamentLevel;
  maxSlots: number;
  date: string;
  location: string;
  registrationCount: number;
  createdAt: string;
}

export interface TournamentRegistration {
  tournamentId: string;
  registrationId: string;
  tournamentName: string;
  category: TournamentCategory;
  level: TournamentLevel;
  memberId: string;
  memberName: string;
  partnerId: string;
  partnerName: string;
  memberExperience?: TournamentExperienceDetails;
  partnerExperience?: TournamentExperienceDetails;
  isIncomingInvitation?: boolean;
  status:
    | 'Invitation Pending'
    | 'Invitation Declined'
    | 'Pending Approval'
    | 'Approved'
    | 'Payment Submitted';
  registeredAt: string;
  approvedAt?: string;
  paymentProofUrl?: string;
}

export interface TournamentPartnerSearchResult {
  memberId: string;
  name: string;
  gender: string;
  eligible: boolean;
  unavailableReason?: string;
}