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

export interface TournamentTeamMember {
  memberId: string;
  name: string;
  gender: string;
  accepted: boolean;
  experience?: TournamentExperienceDetails;
  termsAcceptedAt?: string;
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
  pendingRegistrationCount: number;
  termsUrl?: string;
  termsFileName?: string;
  registrationClosed?: boolean;
  registrationClosedAt?: string;
  createdAt: string;
}

export const tournamentProtestCategories = [
  'Gender requirement',
  'Skill level eligibility',
  'Tournament experience declaration',
  'Terms and conditions',
  'Other',
] as const;

export type TournamentProtestCategory = (typeof tournamentProtestCategories)[number];
export type TournamentProtestStatus = 'Open' | 'Upheld' | 'Dismissed';

export interface TournamentRosterPlayer {
  memberId: string;
  name: string;
  gender: string;
}

export interface TournamentRosterTeam {
  registrationId: string;
  status: string;
  players: TournamentRosterPlayer[];
  isOwnTeam: boolean;
}

export interface TournamentRoster {
  tournamentId: string;
  tournamentName: string;
  category: TournamentCategory;
  level: TournamentLevel;
  teams: TournamentRosterTeam[];
}

export interface TournamentProtestEvidence {
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  url: string;
}

export interface TournamentProtest {
  tournamentId: string;
  protestId: string;
  tournamentName: string;
  protesterId: string;
  protesterName: string;
  protesterRegistrationId: string;
  protestedMemberId: string;
  protestedMemberName: string;
  protestedRegistrationId: string;
  eligibilityCategory: TournamentProtestCategory;
  reason: string;
  evidence: TournamentProtestEvidence[];
  status: TournamentProtestStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
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
  termsUrl?: string;
  memberTermsAcceptedAt?: string;
  partnerTermsAcceptedAt?: string;
  teamMembers?: TournamentTeamMember[];
  isIncomingInvitation?: boolean;
  status:
    | 'Invitation Pending'
    | 'Invitation Declined'
    | 'Pending Approval'
    | 'Approved'
    | 'Payment Submitted'
    | 'Paid';
  registeredAt: string;
  approvedAt?: string;
  paymentProofUrl?: string;
  paymentProofs?: TournamentPaymentProof[];
  paidAt?: string;
  paidBy?: string;
}

export interface TournamentPaymentProof {
  memberId: string;
  memberName: string;
  fileName: string;
  uploadedAt: string;
  url: string;
}

export interface TournamentPartnerSearchResult {
  memberId: string;
  name: string;
  gender: string;
  eligible: boolean;
  unavailableReason?: string;
}