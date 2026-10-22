import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  RequestTimeoutException,
  UnauthorizedException,
} from '@nestjs/common';
import { DefaultAzureCredential } from '@azure/identity';
import { TableClient } from '@azure/data-tables';
import type { TableEntityResult } from '@azure/data-tables';
import { BlobServiceClient, BlockBlobClient } from '@azure/storage-blob';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { buildTeams } from './matching-selection';
import {
  generateTournamentSchedule,
  randomizeTournamentPools,
} from './tournament-scheduling';
import type { TournamentDraw } from './tournament-scheduling';
import {
  advanceLiveDraw,
  liveDrawPhase,
  toLiveDrawView,
} from './tournament-live-draw';
import type { LiveDrawEvent, LiveDrawView } from './tournament-live-draw';
import {
  isPlayerInOngoingGame,
  queueSelectionStrategies,
} from './queue-selection';
import {
  Game,
  GameScore,
  Player,
  PlayerQueueState,
  QueueSelectionMode,
  Round,
  TeamMatchingMode,
} from './queue.types';

interface GameAssignmentInput {
  courtNumber: number;
  playerIds: number[];
}

export interface MonthlyParticipationPlayer {
  name: string;
  count: number;
}

export interface MonthlyParticipationSummary {
  month: string;
  players: MonthlyParticipationPlayer[];
}

export interface MonthlyParticipationSummaryResponse {
  arenaMasterEligibilityCount: number | null;
  lastUpdatedAt: string | null;
  summaries: MonthlyParticipationSummary[];
}

export interface MonthlyParticipationUploadConfig {
  storageAccount: string | null;
  containerName: string | null;
  prefix: string;
  months: string[];
}

export interface MonthlyParticipationUploadFile {
  fileName: string;
  blobName: string;
  size: number;
}

export interface MonthlyParticipationUploadResult {
  targetPath: string;
  uploadedFiles: MonthlyParticipationUploadFile[];
}

export interface DashboardAuthResult {
  authenticated: true;
}

interface MonthlyParticipationFileUploadInput {
  originalname: string;
  buffer: Buffer;
  mimetype?: string;
  size: number;
}

export interface MemberProfileImageUploadInput {
  originalname: string;
  buffer: Buffer;
  mimetype?: string;
  size: number;
}

interface ParticipationSourceFile {
  name: string;
  contents: string;
}

interface ParticipationSourceMonth {
  name: string;
  files: ParticipationSourceFile[];
}

interface ParticipationSummarySource {
  lastUpdatedAt: string | null;
  months: ParticipationSourceMonth[];
}

export interface ImportParticipantsResult {
  importedPlayers: number;
}

interface CsvRow {
  [key: string]: string;
}

interface ReferenceCsvData {
  membershipRows: CsvRow[];
  duprRows: CsvRow[];
}

const scrypt = promisify(scryptCallback);

export const MEMBER_ROLES = ['member', 'club-owner', 'balance-staff', 'admin'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const SORSOGON_TOWNS = [
  'Barcelona',
  'Bulan',
  'Bulusan',
  'Castilla',
  'Casiguran',
  'Donsol',
  'Gubat',
  'Irosin',
  'Juban',
  'Magallanes',
  'Matnog',
  'Pilar',
  'Prieto Diaz',
  'Santa Magdalena',
  'Sorsogon City',
] as const;
export type MemberLocationType = 'Sorsogon' | 'Other';

export interface MemberRegistrationInput {
  name: string;
  email: string;
  contactNo: string;
  emergencyContact: string;
  birthday?: string;
  age?: number;
  showAge?: boolean;
  gender: string;
  duprId?: string;
  reClubId?: string;
  profileImageUrl?: string;
  password: string;
  skills: Record<string, number | null>;
  locationType?: MemberLocationType;
  location?: string;
}

export interface MemberRegistrationResult {
  memberId: string;
  registered: true;
  verificationSent: true;
}

export type MemberRegistrationStatus = 'Pending' | 'Approved';

export interface PendingMemberRegistration {
  memberId: string;
  name: string;
  email: string;
  createdAt: string;
  emailValidated: boolean;
}

export interface MemberRegistrationApprovalResult {
  memberId: string;
  status: 'Approved';
}

export interface AuthenticatedMember {
  memberId: string;
  name: string;
  age: number | null;
  birthday?: string;
  showAge?: boolean;
  gender: string;
  duprId: string;
  reClubId: string;
  profileImageUrl: string;
  skills: Record<string, number | null>;
  createdAt: string;
  emailValidated: boolean;
  role: MemberRole;
  locationType?: MemberLocationType;
  location?: string;
}

export interface MemberLoginResult {
  sessionToken: string;
  expiresAt: string;
  member: AuthenticatedMember;
}

export interface MemberSessionResult {
  authenticated: true;
  member: AuthenticatedMember;
}

export interface MemberDirectoryEntry {
  memberId: string;
  name: string;
  role: string;
  clubName: string;
  profileImageUrl: string;
  location?: string;
}

export interface ClubSummary {
  clubId: string;
  name: string;
}

export interface ClubCreateResult extends ClubSummary {
  createdAt: string;
}

export interface ClubMemberAssignment {
  clubId: string;
  memberId: string;
  role?: 'Member' | 'Officer';
}

export interface PlayerProfileValidation {
  officerName: string;
  clubName: string;
  validatedAt: string;
}

export interface ClubMemberProfileValidation extends MemberDirectoryEntry {
  validations: PlayerProfileValidation[];
}

export type ClubJoinRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export interface ClubJoinRequest {
  clubId: string;
  memberId: string;
  memberName: string;
  status: ClubJoinRequestStatus;
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export const TOURNAMENT_CATEGORIES = [
  "Mens Doubles",
  "Womens Doubles",
  "Mixed Doubles",
  "Team Tournament",
] as const;
export type TournamentCategory = (typeof TOURNAMENT_CATEGORIES)[number];

export const TOURNAMENT_LEVELS = [
  "Beginner",
  "Novice",
  "Low Intermediate",
  "Intermediate",
  "High Intermediate",
  "Advanced",
] as const;
export type TournamentLevel = (typeof TOURNAMENT_LEVELS)[number];

export type TournamentRegistrationStatus =
  | "Invitation Pending"
  | "Invitation Declined"
  | "Pending Approval"
  | "Approved"
  | "Payment Submitted"
  | "Paid";

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
  registrationClosed: boolean;
  registrationClosedAt?: string;
  createdAt: string;
  lifecycleState?: string;
}

export interface ArchivedTournament extends Tournament {
  archivedAt: string;
  archivedBy: string;
}

export interface TournamentArchiveDetails {
  tournament: ArchivedTournament;
  registrations: TournamentRegistration[];
  protests: TournamentProtest[];
  roster: TournamentRoster;
  draw: TournamentDraw | null;
}

export interface TournamentRosterPlayer {
  memberId: string;
  name: string;
  gender: string;
}

export interface TournamentRosterTeam {
  registrationId: string;
  status: TournamentRegistrationStatus;
  players: TournamentRosterPlayer[];
  isOwnTeam: boolean;
}

export interface TournamentRoster {
  tournamentId: string;
  tournamentName: string;
  category: TournamentCategory;
  level: TournamentLevel;
  canManageRoster: boolean;
  teams: TournamentRosterTeam[];
}

export interface TournamentPlanningState {
  roster: TournamentRoster;
  draw: TournamentDraw | null;
  version: string | null;
  rosterChanged: boolean;
}

export interface TournamentLiveDrawState {
  serverNow: string;
  canManage: boolean;
  roster: TournamentRoster;
  event: LiveDrawView | null;
}

export const TOURNAMENT_PROTEST_CATEGORIES = [
  'Gender requirement',
  'Skill level eligibility',
  'Tournament experience declaration',
  'Terms and conditions',
  'Other',
] as const;

export type TournamentProtestCategory = (typeof TOURNAMENT_PROTEST_CATEGORIES)[number];
export type TournamentProtestStatus = 'Open' | 'Upheld' | 'Dismissed';

export interface TournamentProtestEvidence {
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  url: string;
}

interface StoredTournamentProtestEvidence extends Omit<TournamentProtestEvidence, 'url'> {
  blobName: string;
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

export interface TournamentProtestInput {
  protestedMemberId?: string;
  eligibilityCategory?: string;
  reason?: string;
}

export interface TournamentCreateInput {
  name: string;
  category: TournamentCategory;
  level: TournamentLevel;
  maxSlots: number;
  date?: string;
  location?: string;
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
  status: TournamentRegistrationStatus;
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

interface StoredTournamentPaymentProof extends Omit<TournamentPaymentProof, 'url'> {
  blobName: string;
  contentType: string;
}

export interface TournamentTeamMember {
  memberId: string;
  name: string;
  gender: string;
  accepted: boolean;
  experience?: TournamentExperienceDetails;
  termsAcceptedAt?: string;
}

export interface TournamentExperienceDetails {
  hasJoinedTournaments: boolean;
  highestTournamentLevel?: TournamentLevel;
  hasWonTournaments: boolean;
  highestWinningLevel?: TournamentLevel;
  winsOrPodiums?: number;
}

export interface TournamentDocumentUploadInput {
  originalname: string;
  buffer: Buffer;
  mimetype?: string;
  size: number;
}

export type TournamentPaymentProofUploadInput = TournamentDocumentUploadInput;

export interface TournamentPartnerSearchResult {
  memberId: string;
  name: string;
  gender: string;
  eligible: boolean;
  unavailableReason?: string;
}

export interface ClubChatMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  sentAt: string;
}

export interface MemberAccountDetails extends AuthenticatedMember {
  email: string;
  contactNo: string;
  emergencyContact: string;
}

export interface MemberProfileUpdateInput {
  name: string;
  contactNo: string;
  emergencyContact: string;
  birthday?: string;
  age?: number;
  showAge?: boolean;
  gender: string;
  duprId?: string;
  reClubId?: string;
  skills: Record<string, number | null>;
  locationType?: MemberLocationType;
  location?: string;
}

export interface MemberRoleUpdateResult {
  memberId: string;
  role: MemberRole;
}

export interface MemberBalance {
  balanceId: string;
  memberId: string;
  balanceType: string;
  balanceDate: string;
  amount: number;
}

export interface MemberBalanceInput {
  balanceType: string;
  balanceDate: string;
  amount: number;
}

export interface EmailVerificationRequestResult {
  sent: true;
  email: string;
}

export interface EmailVerificationResult {
  verified: true;
}

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private readonly monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  private readonly openPlayParticipationRootPath =
    process.env.OP_PARTICIPATION_ROOT_PATH ??
    join(process.cwd(), 'src', 'data', 'OPParticipation');
  private readonly azureStorageAccount =
    process.env.OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT;
  private readonly membersAzureStorageAccount =
    process.env.MEMBERS_AZURE_STORAGE_ACCOUNT;
  private readonly membersAzureTable = process.env.MEMBERS_AZURE_TABLE;
  private readonly clubsAzureTable = process.env.CLUBS_AZURE_TABLE ?? 'Clubs';
  private readonly clubMembersAzureTable =
    process.env.CLUB_MEMBERS_AZURE_TABLE ?? 'ClubMembers';
  private readonly clubJoinRequestsAzureTable =
    process.env.CLUB_JOIN_REQUESTS_AZURE_TABLE ?? 'ClubJoinRequests';
  private readonly playerReviewsAzureTable =
    process.env.PLAYER_REVIEWS_AZURE_TABLE ?? 'PlayerReviews';
  private readonly tournamentsAzureTable =
    process.env.TOURNAMENTS_AZURE_TABLE ?? 'Tournaments';
  private readonly tournamentArchiveAzureTable =
    process.env.TOURNAMENT_ARCHIVE_AZURE_TABLE ?? 'TournamentArchive';
  private readonly tournamentRegistrationsAzureTable =
    process.env.TOURNAMENT_REGISTRATIONS_AZURE_TABLE ?? 'TournamentRegistrations';
  private readonly tournamentProtestsAzureTable =
    process.env.TOURNAMENT_PROTESTS_AZURE_TABLE ?? 'TournamentProtests';
  private readonly messagesAzureTable =
    process.env.MESSAGES_AZURE_TABLE ?? 'Messages';
  private readonly chatRetentionDays = Math.max(
    1,
    Number.parseInt(process.env.CHAT_RETENTION_DAYS ?? '30', 10) || 30,
  );
  private readonly chatRateLimits = new Map<string, number[]>();
  private lastChatCleanupAt = 0;
  private readonly sessionsAzureTable =
    process.env.MEMBERS_SESSIONS_AZURE_TABLE ?? 'Sessions';
  private readonly balancesAzureTable =
    process.env.MEMBERS_BALANCES_AZURE_TABLE ?? 'Balances';
  private readonly balanceTypesAzureTable =
    process.env.BALANCE_TYPES_AZURE_TABLE ?? 'BalanceTypes';
  private readonly azureContainerName =
    process.env.OP_PARTICIPATION_AZURE_CONTAINER;
  private readonly azurePrefix =
    process.env.OP_PARTICIPATION_AZURE_PREFIX?.replace(/\\/g, '/').replace(
      /^\/+|\/+$/g,
      '',
    ) ?? '';
  private readonly azureUploadTimeoutMs = Number.parseInt(
    process.env.OP_PARTICIPATION_UPLOAD_TIMEOUT_MS ?? '30000',
    10,
  );
  private readonly dashboardPassword = process.env.DASHBOARD_PASSWORD ?? '';
  private readonly publicAppUrl = (
    process.env.PUBLIC_APP_URL ?? 'http://localhost:4200'
  ).replace(/\/$/, '');
  private readonly emailVerificationTtlMinutes = Math.max(
    5,
    Number.parseInt(process.env.EMAIL_VERIFICATION_TTL_MINUTES ?? '60', 10) ||
      60,
  );
  private readonly memberSessionTtlHours = Math.max(
    1,
    Number.parseInt(process.env.MEMBER_SESSION_TTL_HOURS ?? '24', 10) || 24,
  );
  private readonly writableDataRootPath =
    process.env.RUNTIME_DATA_ROOT_PATH ??
    (process.env.WEBSITE_SITE_NAME
      ? join(process.env.HOME ?? '/home', 'data', 'spaqueue')
      : join(process.cwd(), 'src', 'data'));
  private readonly duprMembersBlobPath =
    process.env.OP_PARTICIPATION_DUPR_BLOB_PATH ??
    'SPADUPR/members-list-sorsogonpickleballclub.csv';
  private readonly clubMembershipBlobPath =
    process.env.OP_PARTICIPATION_CLUB_MEMBERSHIP_BLOB_PATH ??
    'SPADUPR/Sorsogon Pickleball Club Member Registration (Responses) - Form Responses 1.csv';
  private readonly duprMembersLocalFilePath =
    process.env.DUPR_MEMBERS_LOCAL_FILE_PATH ??
    join(this.writableDataRootPath, 'members-list-sorsogonpickleballclub.csv');
  private readonly clubMembershipLocalFilePath =
    process.env.CLUB_MEMBERSHIP_LOCAL_FILE_PATH ??
    join(
      this.writableDataRootPath,
      'Sorsogon Pickleball Club Member Registration (Responses) - Form Responses 1.csv',
    );
  private readonly legacyClubMembershipLocalFilePath = join(
    process.cwd(),
    'src',
    'data',
    'Sorsogon Pickleball Club Member Registration (Responses) - Form Responses 1.csv',
  );
  private readonly playersFilePath =
    process.env.PLAYER_LIST_FILE_PATH ??
    join(this.writableDataRootPath, 'players.json');
  private readonly players: Player[] = this.loadPlayers();
  private readonly roundsFilePath =
    process.env.MATCH_HISTORY_FILE_PATH ??
    join(this.writableDataRootPath, 'rounds.json');
  private readonly rounds: Round[] = this.loadRounds();

  private readonly arenaMasterEligibilityCount =
    this.parseArenaMasterEligibilityCount();
  getQueueSnapshot(
    courtCount = 1,
    selectionMode: QueueSelectionMode = 'queue-line',
    matchingMode: TeamMatchingMode = 'dupr-balance',
  ) {
    // Keep fresh local copies of reference CSV files whenever the queue is refreshed.
    void this.syncReferenceCsvFiles();

    const recentCompletedRounds = this.getRecentCompletedRounds();
    const recentCompletedGames = recentCompletedRounds.flatMap(
      (round) => round.games,
    );
    const completedGames = this.getAllGames().filter(
      (game) => game.status === 'completed',
    );
    const playerQueueStates = this.players.map((player) =>
      this.toPlayerQueueState(player, recentCompletedGames, completedGames),
    );
    const ongoingRounds = this.rounds
      .filter((round) => round.status === 'ongoing')
      .map((round) => this.toRoundView(round));
    const recentRounds = recentCompletedRounds.map((round) =>
      this.toRoundView(round),
    );

    return {
      players: playerQueueStates,
      ongoingRounds,
      recentRounds,
      nextGame: this.buildNextGamePreview(
        playerQueueStates,
        courtCount,
        selectionMode,
        matchingMode,
      ),
    };
  }

  updatePlayerReadyState(playerId: number, isReady: boolean) {
    const player = this.players.find((entry) => entry.id === playerId);

    if (!player) {
      throw new NotFoundException(`Player ${playerId} was not found.`);
    }

    player.isReady = isReady;
    player.checkedInAt = isReady ? new Date().toISOString() : null;

    return {
      ...player,
      isPlaying: this.isPlayerInOngoingGame(player.id),
    };
  }

  createGame(playerIds: number[]) {
    return this.createRound([{ courtNumber: 1, playerIds }]);
  }

  createGames(gameAssignments: GameAssignmentInput[]) {
    if (!gameAssignments.length) {
      throw new BadRequestException('At least one game is required.');
    }

    return this.createRound(gameAssignments);
  }

  async importParticipantsFromText(
    sourceText: string,
  ): Promise<ImportParticipantsResult> {
    const referenceData = await this.loadReferenceCsvData();

    const participantNames = this.extractParticipantNames(sourceText);

    if (!participantNames.length) {
      throw new BadRequestException(
        'No participants found. Paste text that includes a Participants (#) section.',
      );
    }

    const membershipReclubHeader = this.findHeader(
      referenceData.membershipRows,
      ['Reclub Name'],
    );
    const membershipSkillHeader = this.findHeader(
      referenceData.membershipRows,
      [
        'Skill Level (Self Assesment)',
        'Skill Level (Self Assessment)',
        'Skill Level',
      ],
    );
    const membershipDuprIdHeader = this.findHeader(
      referenceData.membershipRows,
      ['DUPR ID', 'DUPR Account ID', 'DUPR'],
    );
    const duprIdHeader = this.findHeader(referenceData.duprRows, [
      'DUPR ID',
      'id',
      'dupr id',
    ]);
    const duprDoublesHeader = this.findHeader(referenceData.duprRows, [
      'doubles',
      'Doubles',
    ]);

    const membershipByReclubName = new Map<string, CsvRow>();
    for (const row of referenceData.membershipRows) {
      const name = membershipReclubHeader
        ? row[membershipReclubHeader]?.trim()
        : '';
      if (!name) {
        continue;
      }

      membershipByReclubName.set(this.normalizeName(name), row);
    }

    const duprById = new Map<string, CsvRow>();
    for (const row of referenceData.duprRows) {
      const duprId = duprIdHeader ? row[duprIdHeader]?.trim() : '';
      if (!duprId) {
        continue;
      }

      duprById.set(duprId, row);
    }

    const importedPlayers = participantNames.map((name, index) => {
      const normalizedName = name.trim();
      const membershipRow = membershipByReclubName.get(
        this.normalizeName(normalizedName),
      );
      const skillLevel = this.toSkillLevel(
        membershipSkillHeader && membershipRow
          ? membershipRow[membershipSkillHeader]
          : null,
      );

      const duprId =
        membershipDuprIdHeader && membershipRow
          ? membershipRow[membershipDuprIdHeader]?.trim()
          : '';
      const duprRow = duprId ? duprById.get(duprId) : undefined;
      const duprRating = this.toDuprValue(
        duprDoublesHeader && duprRow ? duprRow[duprDoublesHeader] : null,
      );

      return {
        id: index + 1,
        name: normalizedName,
        dupr: duprRating,
        gender: null,
        skillLevel,
        isReady: false,
        checkedInAt: null,
      } satisfies Player;
    });

    this.players.splice(0, this.players.length, ...importedPlayers);
    this.persistPlayers();
    this.rounds.splice(0, this.rounds.length);
    this.persistRounds();

    return {
      importedPlayers: importedPlayers.length,
    };
  }

  private async syncReferenceCsvFiles() {
    await Promise.all([
      this.syncCsvBlobToLocalFile(
        this.duprMembersBlobPath,
        this.duprMembersLocalFilePath,
      ),
      this.syncCsvBlobToLocalFile(
        this.clubMembershipBlobPath,
        this.clubMembershipLocalFilePath,
      ),
    ]);
  }

  private async syncCsvBlobToLocalFile(
    blobPath: string,
    localFilePath: string,
  ) {
    if (!this.azureStorageAccount || !this.azureContainerName) {
      return;
    }

    const normalizedBlobPath = blobPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const url = `https://${this.azureStorageAccount}.blob.core.windows.net/${this.azureContainerName}/${this.encodeBlobPath(normalizedBlobPath)}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        return;
      }

      const contents = await response.text();

      if (!contents.trim()) {
        return;
      }

      mkdirSync(dirname(localFilePath), { recursive: true });
      writeFileSync(localFilePath, contents, 'utf8');
    } catch {
      // Queue refresh/import should not fail if CSV synchronization is temporarily unavailable.
    }
  }

  private async loadReferenceCsvData(): Promise<ReferenceCsvData> {
    await this.syncReferenceCsvFiles();

    const membershipCsv = this.readFirstExistingFile([
      this.clubMembershipLocalFilePath,
      this.legacyClubMembershipLocalFilePath,
    ]);
    const duprCsv = existsSync(this.duprMembersLocalFilePath)
      ? readFileSync(this.duprMembersLocalFilePath, 'utf8')
      : '';

    return {
      membershipRows: this.parseCsvRows(membershipCsv),
      duprRows: this.parseCsvRows(duprCsv),
    };
  }

  private readFirstExistingFile(paths: string[]): string {
    for (const path of paths) {
      if (existsSync(path)) {
        return readFileSync(path, 'utf8');
      }
    }

    return '';
  }

  private parseCsvRows(contents: string): CsvRow[] {
    const rows = this.parseCsv(contents).filter((row) =>
      row.some((cell) => cell.trim().length > 0),
    );

    if (!rows.length) {
      return [];
    }

    const headers = rows[0].map((header) => header.trim());

    return rows.slice(1).map((cells) => {
      const row: CsvRow = {};

      headers.forEach((header, index) => {
        if (!header) {
          return;
        }

        row[header] = cells[index]?.trim() ?? '';
      });

      return row;
    });
  }

  private parseCsv(contents: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let index = 0; index < contents.length; index += 1) {
      const char = contents[index];
      const nextChar = contents[index + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentCell += '"';
          index += 1;
          continue;
        }

        inQuotes = !inQuotes;
        continue;
      }

      if (!inQuotes && char === ',') {
        currentRow.push(currentCell);
        currentCell = '';
        continue;
      }

      if (!inQuotes && (char === '\n' || char === '\r')) {
        if (char === '\r' && nextChar === '\n') {
          index += 1;
        }

        currentRow.push(currentCell);
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }

        currentRow = [];
        currentCell = '';
        continue;
      }

      currentCell += char;
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell);
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  private findHeader(
    rows: CsvRow[],
    candidateHeaders: string[],
  ): string | null {
    if (!rows.length) {
      return null;
    }

    const availableHeaders = Object.keys(rows[0]);
    const normalizedHeaders = new Map(
      availableHeaders.map((header) => [this.normalizeHeader(header), header]),
    );

    for (const candidateHeader of candidateHeaders) {
      const match = normalizedHeaders.get(
        this.normalizeHeader(candidateHeader),
      );

      if (match) {
        return match;
      }
    }

    return null;
  }

  private normalizeHeader(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private toSkillLevel(
    rawSkillLevel: string | null | undefined,
  ): Player['skillLevel'] {
    const normalized = (rawSkillLevel ?? '').trim().toLowerCase();

    if (!normalized) {
      return 'N/A';
    }

    if (normalized === 'beginner') {
      return 'Beginner';
    }

    if (normalized === 'novice') {
      return 'Novice';
    }

    if (normalized === 'intermediate') {
      return 'Intermediate';
    }

    if (normalized === 'high intermediate') {
      return 'High Intermediate';
    }

    if (normalized === 'advanced') {
      return 'Advanced';
    }

    return 'N/A';
  }

  private toDuprValue(rawDupr: string | null | undefined): number | null {
    const normalized = (rawDupr ?? '').trim();

    if (!normalized.length) {
      return null;
    }

    const parsed = Number(normalized);

    if (!Number.isFinite(parsed)) {
      return null;
    }

    return parsed;
  }

  private persistPlayers(players = this.players) {
    mkdirSync(dirname(this.playersFilePath), { recursive: true });
    writeFileSync(
      this.playersFilePath,
      `${JSON.stringify(players, null, 2)}\n`,
      'utf8',
    );
  }

  private loadPlayers() {
    if (!existsSync(this.playersFilePath)) {
      this.persistPlayers([]);
      return [];
    }

    const fileContents = readFileSync(this.playersFilePath, 'utf8');

    if (!fileContents.trim()) {
      this.persistPlayers([]);
      return [];
    }

    const players = JSON.parse(fileContents) as Player[];

    return players.map((player) => ({
      ...player,
    }));
  }

  async getMonthlyParticipationSummary(): Promise<MonthlyParticipationSummaryResponse> {
    const source =
      this.azureStorageAccount && this.azureContainerName
        ? await this.loadMonthsFromAzureBlobStorage()
        : this.loadMonthsFromLocalFilesystem();

    return {
      arenaMasterEligibilityCount: this.arenaMasterEligibilityCount,
      lastUpdatedAt: source.lastUpdatedAt,
      summaries: source.months
        .sort((left, right) => this.compareMonthNames(left.name, right.name))
        .map((month) => ({
          month: month.name,
          players: this.getMonthlyParticipationPlayers(month),
        })),
    };
  }

  getMonthlyParticipationUploadConfig(): MonthlyParticipationUploadConfig {
    return {
      storageAccount: this.azureStorageAccount ?? null,
      containerName: this.azureContainerName ?? null,
      prefix: this.azurePrefix,
      months: this.monthNames,
    };
  }

  validateDashboardPassword(password: string): DashboardAuthResult {
    if (!this.dashboardPassword) {
      throw new UnauthorizedException('Dashboard password is not configured.');
    }

    const expectedPassword = Buffer.from(this.dashboardPassword);
    const providedPassword = Buffer.from(password);
    const isValidPassword =
      expectedPassword.length === providedPassword.length &&
      timingSafeEqual(expectedPassword, providedPassword);

    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid dashboard password.');
    }

    return { authenticated: true };
  }

  async registerMember(
    input: MemberRegistrationInput,
    profileImage?: MemberProfileImageUploadInput,
  ): Promise<MemberRegistrationResult> {
    const member = this.validateMemberRegistration(input);
    const tableClient = this.getMembersTableClient();
    const emailKey = Buffer.from(member.email).toString('base64url');
    const passwordHash = member.password
      ? await this.hashPassword(member.password)
      : undefined;
    const profileImageUrl = profileImage
      ? await this.uploadMemberProfileImage(emailKey, profileImage)
      : member.profileImageUrl;

    try {
      await tableClient.createEntity({
        partitionKey: 'members',
        rowKey: emailKey,
        Name: member.name,
        Email: member.email,
        ContactNo: member.contactNo,
        EmergencyContact: member.emergencyContact,
        ...(member.birthday
          ? { Birthday: member.birthday }
          : { Age: member.age }),
        ShowAge: member.showAge === true,
        LocationType: member.locationType,
        Location: member.location,
        Gender: member.gender,
        DUPRId: member.duprId,
        ReclubId: member.reClubId,
        ProfileImageUrl: profileImageUrl,
        EmailValidated: false,
        Status: 'Pending',
        Role: 'member',
        ...(passwordHash ? { PasswordHash: passwordHash } : {}),
        Skills: JSON.stringify(member.skills),
        CreatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (this.isAzureConflict(error)) {
        throw new ConflictException(
          'An account with this email address already exists.',
        );
      }

      throw this.createMemberRegistrationStorageException(error);
    }

    try {
      await this.requestEmailVerification(emailKey);
    } catch (error) {
      await tableClient
        .deleteEntity('members', emailKey)
        .catch(() => undefined);
      throw error;
    }

    return { memberId: emailKey, registered: true, verificationSent: true };
  }

  async loginMember(
    emailInput: string,
    password: string,
  ): Promise<MemberLoginResult> {
    const email = emailInput.trim().toLowerCase();

    if (!email || !password) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const memberId = Buffer.from(email).toString('base64url');
    const tableClient = this.getMembersTableClient();
    let member: Record<string, unknown>;

    try {
      member = await tableClient.getEntity('members', memberId);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new UnauthorizedException('Invalid email or password.');
      }

      throw this.createMemberAuthenticationStorageException(error);
    }

    const passwordHash = String(member.PasswordHash ?? '');
    const passwordIsValid = await this.verifyPassword(password, passwordHash);

    if (!passwordIsValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (member.Status !== undefined && member.Status !== 'Approved') {
      throw new ForbiddenException('Your registration is pending approval.');
    }

    const sessionToken = randomBytes(32).toString('base64url');
    const sessionId = this.hashSessionToken(sessionToken);
    const expiresAt = new Date(
      Date.now() + this.memberSessionTtlHours * 60 * 60 * 1000,
    ).toISOString();
    const sessionsTableClient = this.getSessionsTableClient();

    try {
      await sessionsTableClient.createEntity({
        partitionKey: 'sessions',
        rowKey: sessionId,
        MemberId: memberId,
        Role: this.getMemberRole(member),
        ExpiresAt: expiresAt,
        CreatedAt: new Date().toISOString(),
      });
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return {
      sessionToken,
      expiresAt,
      member: this.toAuthenticatedMember(memberId, member),
    };
  }

  async getMemberSession(sessionToken: string): Promise<MemberSessionResult> {
    if (!sessionToken) {
      throw new UnauthorizedException('Member session is required.');
    }

    const tableClient = this.getMembersTableClient();
    const sessionsTableClient = this.getSessionsTableClient();
    const sessionId = this.hashSessionToken(sessionToken);
    let session: Record<string, unknown>;

    try {
      session = await sessionsTableClient.getEntity('sessions', sessionId);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new UnauthorizedException(
          'Member session is invalid or expired.',
        );
      }

      throw this.createMemberAuthenticationStorageException(error);
    }

    const expiresAt = Date.parse(String(session.ExpiresAt ?? ''));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await sessionsTableClient
        .deleteEntity('sessions', sessionId)
        .catch(() => undefined);
      throw new UnauthorizedException('Member session is invalid or expired.');
    }

    const memberId = String(session.MemberId ?? '');

    try {
      const member = await tableClient.getEntity('members', memberId);
      return {
        authenticated: true,
        member: this.toAuthenticatedMember(memberId, member),
      };
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new UnauthorizedException(
          'Member session is invalid or expired.',
        );
      }

      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  async getClubChatMessages(sessionToken: string): Promise<ClubChatMessage[]> {
    await this.getMemberSession(sessionToken);
    await this.cleanupExpiredClubChatMessages();
    const messages: ClubChatMessage[] = [];

    try {
      const entities = this.getMessagesTableClient().listEntities({
        queryOptions: {
          filter: "PartitionKey eq 'club-chat'",
          select: [
            'RowKey',
            'SenderId',
            'SenderName',
            'Text',
            'SentAt',
            'ExpiresAt',
          ],
        },
      });

      // Inverted timestamp RowKeys make ascending table order newest-first.
      for await (const entity of entities) {
        const expiresAt = Date.parse(String(entity.ExpiresAt ?? ''));
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) continue;
        messages.push({
          messageId: String(entity.rowKey ?? ''),
          senderId: String(entity.SenderId ?? ''),
          senderName: String(entity.SenderName ?? 'Member'),
          text: String(entity.Text ?? ''),
          sentAt: String(entity.SentAt ?? ''),
        });
        if (messages.length >= 50) break;
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return messages.reverse();
  }

  async sendClubChatMessage(
    sessionToken: string,
    textInput: string,
  ): Promise<ClubChatMessage> {
    const session = await this.getMemberSession(sessionToken);
    const text = textInput.trim();
    if (!text || text.length > 1000) {
      throw new BadRequestException(
        'Messages must contain 1 to 1000 characters.',
      );
    }

    this.enforceChatRateLimit(session.member.memberId);
    await this.cleanupExpiredClubChatMessages();
    const sentAt = new Date().toISOString();
    const rowKey = `${String(Number.MAX_SAFE_INTEGER - Date.now()).padStart(16, '0')}_${randomUUID()}`;
    const expiresAt = new Date(
      Date.now() + this.chatRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const message: ClubChatMessage = {
      messageId: rowKey,
      senderId: session.member.memberId,
      senderName: session.member.name,
      text,
      sentAt,
    };

    try {
      await this.getMessagesTableClient().createEntity({
        partitionKey: 'club-chat',
        rowKey,
        SenderId: message.senderId,
        SenderName: message.senderName,
        Text: message.text,
        SentAt: sentAt,
        ExpiresAt: expiresAt,
      });
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return message;
  }

  async getMemberDirectory(
    sessionToken: string,
    location = '',
    clubId = '',
  ): Promise<MemberDirectoryEntry[]> {
    await this.getMemberSession(sessionToken);
    const members: MemberDirectoryEntry[] = [];
    const assignedMemberIds = clubId
      ? await this.getClubMemberIds(clubId)
      : null;

    try {
      const entities = this.getMembersTableClient().listEntities({
        queryOptions: {
          filter: "PartitionKey eq 'members'",
          select: [
            'RowKey',
            'Name',
            'Role',
            'ClubName',
            'ProfileImageUrl',
            'LocationType',
            'Location',
            'Status',
            'EmailValidated',
          ],
        },
      });

      for await (const entity of entities) {
        const memberId = String(entity.rowKey ?? '');
        const name = String(entity.Name ?? '').trim();

        if (!memberId || !name) {
          continue;
        }
        if (entity.Status !== 'Approved' || entity.EmailValidated !== true) {
          continue;
        }

        const memberLocation = String(entity.Location ?? '').trim();
        if (
          location &&
          (location === 'Other'
            ? String(entity.LocationType ?? '') !== 'Other'
            : memberLocation !== location)
        ) {
          continue;
        }
        if (assignedMemberIds && !assignedMemberIds.has(memberId)) {
          continue;
        }

        members.push({
          memberId,
          name,
          role: String(entity.Role ?? 'Club Member'),
          clubName: String(entity.ClubName ?? 'Sorsogon Pickleball Club'),
          profileImageUrl: String(entity.ProfileImageUrl ?? ''),
          ...(memberLocation ? { location: memberLocation } : {}),
        });
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return members.sort((left, right) => left.name.localeCompare(right.name));
  }

  async getClubs(sessionToken: string): Promise<ClubSummary[]> {
    await this.getMemberSession(sessionToken);
    const clubs: ClubSummary[] = [];

    try {
      const entities = this.getClubsTableClient().listEntities();
      for await (const entity of entities) {
        const clubId = String(entity.rowKey ?? entity.ClubId ?? '').trim();
        const name = String(entity.Name ?? entity.ClubName ?? '').trim();
        if (clubId && name) {
          clubs.push({ clubId, name });
        }
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return clubs.sort((left, right) => left.name.localeCompare(right.name));
  }

  async getTournaments(sessionToken: string): Promise<Tournament[]> {
    await this.getMemberSession(sessionToken);
    const tournaments: Tournament[] = [];
    const registrationCounts = new Map<string, number>();
    const pendingRegistrationCounts = new Map<string, number>();

    try {
      for await (const entity of this.getTournamentRegistrationsTableClient().listEntities()) {
        const status = String(entity.Status ?? '');
        const tournamentId = String(entity.TournamentId ?? entity.partitionKey ?? '');
        if (this.isApprovedTournamentRegistration(status)) {
          registrationCounts.set(tournamentId, (registrationCounts.get(tournamentId) ?? 0) + 1);
        } else if (status === 'Invitation Pending' || status === 'Pending Approval') {
          pendingRegistrationCounts.set(tournamentId, (pendingRegistrationCounts.get(tournamentId) ?? 0) + 1);
        }
      }

      for await (const entity of this.getTournamentsTableClient().listEntities({
        queryOptions: { filter: "PartitionKey eq 'tournaments'" },
      })) {
        const tournament = this.toTournament(entity);
        if (tournament) {
          tournaments.push({
            ...tournament,
            registrationCount: registrationCounts.get(tournament.tournamentId) ?? 0,
            pendingRegistrationCount: pendingRegistrationCounts.get(tournament.tournamentId) ?? 0,
          });
        }
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return tournaments.sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name));
  }

  async getArchivedTournaments(sessionToken: string): Promise<ArchivedTournament[]> {
    await this.requireAdminSession(sessionToken);
    const items: ArchivedTournament[] = [];
    try {
      for await (const entity of this.getTournamentArchiveTableClient().listEntities({
        queryOptions: { filter: "PartitionKey eq 'tournaments'" },
      })) {
        const tournament = this.toTournament(entity);
        if (tournament && entity.ArchiveComplete === true) {
          items.push({
            ...tournament,
            ...(tournament.termsUrl ? { termsUrl: `/admin/tournament-archive/${tournament.tournamentId}/terms` } : {}),
            archivedAt: String(entity.ArchivedAt), archivedBy: String(entity.ArchivedBy),
          });
        }
      }
    } catch (error) {
      if (!this.isAzureNotFound(error)) throw this.tournamentLifecycleStorageException(error);
    }
    return items.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }

  async getTournamentArchiveDetails(sessionToken: string, tournamentId: string): Promise<TournamentArchiveDetails> {
    await this.requireAdminSession(sessionToken);
    const entity = await this.getArchivedTournamentEntity(tournamentId);
    if (entity.ArchiveComplete !== true) throw new ConflictException('Archiving is incomplete. Retry Archive in tournament management.');
    const tournament = this.toTournament(entity);
    if (!tournament) throw new BadGatewayException('Stored archived tournament is invalid.');
    const registrationEntities = await this.getArchivedTournamentChildren(tournamentId, 'registrations');
    const registrations = registrationEntities
      .map((item) => this.toTournamentRegistration({ ...item, partitionKey: tournamentId }))
      .filter((item): item is TournamentRegistration => !!item);
    const protests = (await this.getArchivedTournamentChildren(tournamentId, 'protests'))
      .map((item) => this.toTournamentProtest({ ...item, partitionKey: tournamentId }))
      .filter((item): item is TournamentProtest => !!item);
    const archiveUrl = `/admin/tournament-archive/${tournamentId}`;
    if (tournament.termsUrl) tournament.termsUrl = `${archiveUrl}/terms`;
    for (const registration of registrations) {
      if (registration.termsUrl) registration.termsUrl = tournament.termsUrl;
      if (registration.paymentProofUrl) {
        registration.paymentProofUrl = `${archiveUrl}/registrations/${encodeURIComponent(registration.registrationId)}/payment-proofs/legacy`;
      }
      for (const proof of registration.paymentProofs ?? []) {
        proof.url = `${archiveUrl}/registrations/${encodeURIComponent(registration.registrationId)}/payment-proofs/${encodeURIComponent(proof.memberId)}`;
      }
    }
    for (const protest of protests) {
      protest.evidence.forEach((evidence, index) => {
        evidence.url = `${archiveUrl}/protests/${encodeURIComponent(protest.protestId)}/evidence/${index}`;
      });
    }
    const roster: TournamentRoster = {
      tournamentId, tournamentName: tournament.name, category: tournament.category,
      level: tournament.level, canManageRoster: false,
      teams: registrations.filter((item) => this.isApprovedTournamentRegistration(item.status)).map((item) => ({
        registrationId: item.registrationId, status: item.status, isOwnTeam: false,
        players: item.teamMembers?.length
          ? item.teamMembers.map(({ memberId, name, gender }) => ({ memberId, name, gender }))
          : [{ memberId: item.memberId, name: item.memberName, gender: '' },
            { memberId: item.partnerId, name: item.partnerName, gender: '' }],
      })),
    };
    tournament.registrationCount = roster.teams.length;
    tournament.pendingRegistrationCount = registrations.filter((item) =>
      item.status === 'Invitation Pending' || item.status === 'Pending Approval',
    ).length;
    return {
      tournament: { ...tournament, archivedAt: String(entity.ArchivedAt), archivedBy: String(entity.ArchivedBy) },
      registrations, protests, roster, draw: await this.readTournamentDraw(tournamentId, entity),
    };
  }

  async archiveTournament(sessionToken: string, tournamentId: string): Promise<{ archived: true }> {
    const session = await this.requireAdminSession(sessionToken);
    const entity = await this.beginTournamentLifecycle(tournamentId, 'Archiving', session.member.name || session.member.memberId);
    const archive = this.getTournamentArchiveTableClient();
    try {
      const groups = [
        ['registrations', this.getTournamentRegistrationsTableClient(), await this.getTournamentRegistrationEntities(tournamentId)],
        ['protests', this.getTournamentProtestsTableClient(), await this.getTournamentProtestEntities(tournamentId)],
      ] as const;
      // Copy every record before removing any source records. Retrying resumes a partial move.
      const { etag: _etag, timestamp: _timestamp, ...properties } = entity;
      await archive.upsertEntity({
        ...properties, partitionKey: 'tournaments', rowKey: tournamentId,
        LifecycleState: 'Archived',
        ArchivedAt: String(entity.LifecycleStartedAt), ArchivedBy: String(entity.LifecycleStartedBy),
        ArchiveComplete: false,
      }, 'Replace');
      for (const [kind, , children] of groups) {
        for (const child of children) {
          const { etag: _childEtag, timestamp: _childTimestamp, ...values } = child;
          await archive.upsertEntity({
            ...values, partitionKey: `${tournamentId}:${kind}`, rowKey: String(child.rowKey),
          }, 'Replace');
        }
      }
      // All partitions must be copied successfully before any source data is removed.
      for (const [, table, children] of groups) {
        for (const child of children) await table.deleteEntity(tournamentId, String(child.rowKey), { etag: String(child.etag ?? '*') });
      }
      const savedRegistrations = await this.getArchivedTournamentChildren(tournamentId, 'registrations');
      await archive.updateEntity({
        partitionKey: 'tournaments', rowKey: tournamentId, ArchiveComplete: true,
        ArchivedRegistrationCount: savedRegistrations.filter((item) => this.isApprovedTournamentRegistration(String(item.Status))).length,
        ArchivedPendingRegistrationCount: savedRegistrations.filter((item) =>
          item.Status === 'Invitation Pending' || item.Status === 'Pending Approval',
        ).length,
      }, 'Merge');
      await this.getTournamentsTableClient().deleteEntity('tournaments', tournamentId, { etag: String(entity.etag ?? '*') });
    } catch (error) {
      throw this.tournamentLifecycleStorageException(error);
    }
    return { archived: true };
  }

  async deleteTournament(sessionToken: string, tournamentId: string, archived = false): Promise<{ deleted: true }> {
    await this.requireAdminSession(sessionToken);
    const entity = archived
      ? await this.getArchivedTournamentEntity(tournamentId)
      : await this.beginTournamentLifecycle(tournamentId, 'Deleting');
    if (archived) {
      try {
        await this.getTournamentsTableClient().getEntity('tournaments', tournamentId);
      } catch (error) {
        if (!this.isAzureNotFound(error)) throw this.tournamentLifecycleStorageException(error);
        return this.purgeTournamentData(tournamentId, entity, true);
      }
      throw new ConflictException('Archiving is still in progress. Retry Archive in tournament management first.');
    }
    return this.purgeTournamentData(tournamentId, entity, false);
  }

  private async purgeTournamentData(
    tournamentId: string, entity: Record<string, unknown>, archived: boolean,
  ): Promise<{ deleted: true }> {
    const archive = this.getTournamentArchiveTableClient();
    try {
      // Prefix enumeration also removes old proofs, superseded draws and orphaned uploads.
      const container = this.getTournamentDocumentContainerClient();
      for (const prefix of ['tournament-terms', 'tournament-payment-proofs', 'tournament-protest-evidence', 'tournament-draws', 'tournament-live-draws']) {
        const deletedNames = new Set<string>();
        for await (const blob of container.listBlobsFlat({ prefix: `${prefix}/${tournamentId}/`, includeVersions: true })) {
          const client = container.getBlockBlobClient(blob.name);
          if (!deletedNames.has(blob.name)) {
            await client.deleteIfExists({ deleteSnapshots: 'include' });
            deletedNames.add(blob.name);
          }
          if (blob.versionId) await client.withVersion(blob.versionId).deleteIfExists();
        }
      }
      for (const [kind, table, children] of [
        ['registrations', this.getTournamentRegistrationsTableClient(), await this.getTournamentRegistrationEntities(tournamentId)],
        ['protests', this.getTournamentProtestsTableClient(), await this.getTournamentProtestEntities(tournamentId)],
      ] as const) {
        for (const child of children) await table.deleteEntity(tournamentId, String(child.rowKey), { etag: String(child.etag ?? '*') });
        for (const child of await this.getArchivedTournamentChildren(tournamentId, kind)) {
          await archive.deleteEntity(`${tournamentId}:${kind}`, String(child.rowKey), { etag: String(child.etag ?? '*') });
        }
      }
      await this.deleteTournamentEntityIfExists(archive, 'tournaments', tournamentId);
      if (!archived) {
        await this.getTournamentsTableClient().deleteEntity('tournaments', tournamentId, { etag: String(entity.etag ?? '*') });
      }
    } catch (error) {
      throw this.tournamentLifecycleStorageException(error);
    }
    return { deleted: true };
  }

  private tournamentLifecycleStorageException(error: unknown) {
    this.logger.error('Tournament archive/delete storage operation failed.', error);
    return new BadGatewayException('Unable to complete the tournament operation. Some steps may have completed; retry the same action to finish safely.');
  }

  private getTournamentArchiveTableClient(): TableClient {
    if (!this.membersAzureStorageAccount) throw new BadRequestException('MEMBERS_AZURE_STORAGE_ACCOUNT is required for tournament archives.');
    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.tournamentArchiveAzureTable, new DefaultAzureCredential(),
    );
  }

  private async getArchivedTournamentEntity(tournamentId: string): Promise<Record<string, unknown>> {
    if (!/^[A-Fa-f0-9-]{36}$/.test(tournamentId)) throw new BadRequestException('Invalid tournament identifier.');
    try {
      return await this.getTournamentArchiveTableClient().getEntity('tournaments', tournamentId);
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Archived tournament was not found.');
      throw this.tournamentLifecycleStorageException(error);
    }
  }

  private async getArchivedTournamentChildren(tournamentId: string, kind: 'registrations' | 'protests') {
    const items: Record<string, unknown>[] = [];
    try {
      for await (const entity of this.getTournamentArchiveTableClient().listEntities({
        queryOptions: { filter: `PartitionKey eq '${tournamentId}:${kind}'` },
      })) items.push(entity);
    } catch (error) {
      if (!this.isAzureNotFound(error)) throw this.tournamentLifecycleStorageException(error);
    }
    return items;
  }

  private async getArchivedTournamentChild(tournamentId: string, kind: 'registrations' | 'protests', rowKey: string) {
    await this.getArchivedTournamentEntity(tournamentId);
    try {
      return await this.getTournamentArchiveTableClient().getEntity<Record<string, unknown>>(`${tournamentId}:${kind}`, rowKey);
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Archived tournament record was not found.');
      throw this.tournamentLifecycleStorageException(error);
    }
  }

  private async deleteTournamentEntityIfExists(table: TableClient, partitionKey: string, rowKey: string) {
    try {
      await table.deleteEntity(partitionKey, rowKey);
    } catch (error) {
      if (!this.isAzureNotFound(error)) throw error;
    }
  }

  private async beginTournamentLifecycle(tournamentId: string, state: 'Archiving' | 'Deleting', actor = '') {
    if (!/^[A-Fa-f0-9-]{36}$/.test(tournamentId)) throw new BadRequestException('Invalid tournament identifier.');
    const entity = await this.getTournamentPlanningEntity(tournamentId);
    if (entity.LifecycleState && entity.LifecycleState !== state) {
      throw new ConflictException(`This tournament is already ${String(entity.LifecycleState).toLowerCase()}. Retry that action first.`);
    }
    if (!entity.LifecycleState) {
      try {
        await this.getTournamentsTableClient().updateEntity({
          partitionKey: 'tournaments', rowKey: tournamentId, LifecycleState: state,
          LifecycleStartedAt: new Date().toISOString(), LifecycleStartedBy: actor,
        }, 'Merge', { etag: entity.etag });
      } catch (error) {
        if (this.isTournamentRegistrationVersionConflict(error)) throw new ConflictException('The tournament changed. Reload and retry.');
        throw this.tournamentLifecycleStorageException(error);
      }
      return this.getTournamentPlanningEntity(tournamentId);
    }
    return entity;
  }

  async createTournament(
    sessionToken: string,
    input: TournamentCreateInput,
    termsFile?: TournamentDocumentUploadInput,
  ): Promise<Tournament> {
    const session = await this.getMemberSession(sessionToken);
    if (session.member.role !== 'admin') {
      throw new ForbiddenException('Administrator access is required.');
    }

    const name = String(input?.name ?? '').trim().replace(/\s+/g, ' ');
    const category = input?.category;
    const level = input?.level;
    const maxSlots = Number(input?.maxSlots);
    const date = String(input?.date ?? '').trim();
    const location = String(input?.location ?? '').trim();
    if (!name || name.length > 120) {
      throw new BadRequestException('Tournament name is required and must be 120 characters or fewer.');
    }
    if (!TOURNAMENT_CATEGORIES.includes(category)) {
      throw new BadRequestException('Select a valid tournament category.');
    }
    if (!TOURNAMENT_LEVELS.includes(level)) {
      throw new BadRequestException('Select a valid tournament level.');
    }
    if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 10000) {
      throw new BadRequestException('Maximum slots must be a whole number from 1 to 10000.');
    }
    if (date && Number.isNaN(Date.parse(date))) {
      throw new BadRequestException('Enter a valid tournament date.');
    }

    const tournamentId = randomUUID();
    let termsBlobName: string | undefined;
    if (termsFile) {
      if (
        termsFile.mimetype !== 'application/pdf' ||
        !termsFile.size || termsFile.size > 10 * 1024 * 1024 ||
        termsFile.buffer.length !== termsFile.size ||
        termsFile.buffer.subarray(0, 5).toString('ascii') !== '%PDF-'
      ) {
        throw new BadRequestException('Terms and conditions must be a PDF file no larger than 10 MB.');
      }
      termsBlobName = `tournament-terms/${tournamentId}/${randomUUID()}.pdf`;
      const blob = this.getTournamentDocumentBlobClient(termsBlobName);
      try {
        await this.uploadParticipationBlob(blob, termsFile.buffer, 'application/pdf');
      } catch (error) {
        throw this.createAzureUploadException(error, termsBlobName);
      }
    }
    const createdAt = new Date().toISOString();
    const tournament: Tournament = {
      tournamentId,
      name,
      category,
      level,
      maxSlots,
      date,
      location,
      registrationCount: 0,
      pendingRegistrationCount: 0,
      registrationClosed: false,
      createdAt,
      ...(termsFile ? {
        termsUrl: this.tournamentTermsUrl(tournamentId),
        termsFileName: termsFile.originalname,
      } : {}),
    };

    try {
      await this.getTournamentsTableClient().createEntity({
        partitionKey: 'tournaments',
        rowKey: tournamentId,
        ...this.toTournamentEntity(tournament),
        CreatedBy: session.member.memberId,
        ...(termsFile && termsBlobName ? { TermsBlobName: termsBlobName, TermsFileName: termsFile.originalname } : {}),
      });
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return tournament;
  }

  async getTournamentTerms(sessionToken: string, tournamentId: string, archived = false): Promise<Buffer> {
    if (archived) await this.requireAdminSession(sessionToken);
    else await this.getMemberSession(sessionToken);
    let entity: Record<string, unknown>;
    try {
      entity = archived
        ? await this.getArchivedTournamentEntity(tournamentId)
        : await this.getTournamentsTableClient().getEntity('tournaments', tournamentId);
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
    if (!archived && entity.LifecycleState) throw new ConflictException('This tournament is being archived or deleted.');
    const blobName = String(entity.TermsBlobName ?? '');
    if (!blobName) throw new NotFoundException('This tournament has no terms and conditions document.');
    if (!blobName.startsWith(`tournament-terms/${tournamentId}/`)) {
      throw new BadGatewayException('Stored tournament terms location is invalid.');
    }
    try {
      return await this.getTournamentDocumentBlobClient(blobName).downloadToBuffer();
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Terms and conditions document was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  async getEligibleTournamentPartners(
    sessionToken: string,
    tournamentId: string,
    searchInput: string,
  ): Promise<TournamentPartnerSearchResult[]> {
    const session = await this.getMemberSession(sessionToken);
    const tournament = await this.getTournament(tournamentId);
    const searchTerm = String(searchInput ?? '').trim().toLocaleLowerCase();
    if (searchTerm.length < 2) return [];
    const partners: TournamentPartnerSearchResult[] = [];
    const activeRegistrations = (await this.getTournamentRegistrationEntities(tournamentId))
      .filter((entity) => String(entity.Status ?? '') !== 'Invitation Declined');
    const committedMemberIds = new Set(
      activeRegistrations.flatMap((entity) => this.tournamentRegistrationMemberIds(entity)),
    );
    const entries = this.getMembersTableClient().listEntities({
      queryOptions: {
        filter: "PartitionKey eq 'members' and Status eq 'Approved'",
        select: ['RowKey', 'Name', 'Gender'],
      },
    });

    try {
      for await (const entity of entries) {
        const memberId = String(entity.rowKey ?? '');
        const name = String(entity.Name ?? '');
        const gender = String(entity.Gender ?? '');
        if (!memberId || !name || !name.toLocaleLowerCase().includes(searchTerm)) continue;

        let unavailableReason: string | undefined;
        if (memberId === session.member.memberId) {
          unavailableReason = 'This is your account.';
        } else if (committedMemberIds.has(memberId)) {
          unavailableReason = 'Already registered or invited for this tournament.';
        } else if (!this.isTournamentGenderEligible(tournament.category, session.member.gender, gender)) {
          unavailableReason = 'Does not meet this tournament category\'s gender requirements.';
        }
        partners.push({
          memberId,
          name,
          gender,
          eligible: !unavailableReason,
          ...(unavailableReason ? { unavailableReason } : {}),
        });
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return partners.sort((left, right) => left.name.localeCompare(right.name));
  }

  async getMyTournamentRegistrations(
    sessionToken: string,
  ): Promise<TournamentRegistration[]> {
    const session = await this.getMemberSession(sessionToken);
    const registrations: TournamentRegistration[] = [];
    try {
      for await (const entity of this.getTournamentRegistrationsTableClient().listEntities()) {
        if (
          String(entity.MemberId ?? '') !== session.member.memberId &&
          String(entity.PartnerId ?? '') !== session.member.memberId &&
          !this.readTournamentTeamMembers(entity).some((member) => member.memberId === session.member.memberId)
        ) {
          continue;
        }
        const registration = this.toTournamentRegistration(entity);
        if (registration) {
          registrations.push({
            ...registration,
            isIncomingInvitation:
              registration.status === 'Invitation Pending' &&
              (registration.teamMembers?.some((member) =>
                member.memberId === session.member.memberId && !member.accepted,
              ) ?? registration.partnerId === session.member.memberId),
          });
        }
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }
    return registrations.sort((left, right) => right.registeredAt.localeCompare(left.registeredAt));
  }

  async registerTournamentTeam(
    sessionToken: string,
    tournamentId: string,
    partnerIdInput: string,
    memberExperienceInput: unknown,
    teamMemberIdsInput?: unknown,
    termsAccepted?: unknown,
  ): Promise<TournamentRegistration> {
    const session = await this.getMemberSession(sessionToken);
    const tournament = await this.getTournament(tournamentId);
    this.requireOpenTournamentRegistration(tournament);
    this.requireTournamentTermsAgreement(tournament, termsAccepted);
    const termsAcceptedAt = tournament.termsUrl ? new Date().toISOString() : undefined;
    const memberExperience = this.validateTournamentExperience(memberExperienceInput);
    const isTeamTournament = tournament.category === 'Team Tournament';
    const selectedMemberIds = isTeamTournament
      ? this.validateTeamTournamentMemberIds(teamMemberIdsInput)
      : [String(partnerIdInput ?? '').trim()];
    if (
      selectedMemberIds.some((memberId) => !memberId || memberId === session.member.memberId) ||
      new Set(selectedMemberIds).size !== selectedMemberIds.length
    ) {
      throw new BadRequestException(isTeamTournament
        ? 'Select three different members other than yourself.'
        : 'Select another member as your partner.');
    }

    const selectedMembers = await Promise.all(selectedMemberIds.map((memberId) => this.getTournamentMember(memberId)));
    const partnerId = selectedMemberIds[0];
    const partner = selectedMembers[0];
    if (!isTeamTournament && !this.isTournamentGenderEligible(tournament.category, session.member.gender, partner.gender)) {
      throw new BadRequestException('Your selected partner does not meet this tournament category\'s gender requirements.');
    }

    let teamMembers: TournamentTeamMember[] | undefined;
    if (isTeamTournament) {
      teamMembers = [
        {
          memberId: session.member.memberId,
          name: session.member.name,
          gender: session.member.gender,
          accepted: true,
          experience: memberExperience,
          ...(termsAcceptedAt ? { termsAcceptedAt } : {}),
        },
        ...selectedMembers.map((member, index) => ({
          memberId: selectedMemberIds[index],
          name: member.name,
          gender: member.gender,
          accepted: false,
        })),
      ];
      const maleCount = teamMembers.filter((member) => this.tournamentGenderGroup(member.gender) === 'male').length;
      const femaleCount = teamMembers.filter((member) => this.tournamentGenderGroup(member.gender) === 'female').length;
      if (maleCount !== 2 || femaleCount !== 2) {
        throw new BadRequestException('A Team Tournament roster must contain exactly two men and two women, including you.');
      }
    }

    const registrations = await this.getTournamentRegistrationEntities(tournamentId);
    const existing = registrations.find((entity) => String(entity.MemberId ?? '') === session.member.memberId);
    const activeRegistrations = registrations.filter((entity) => String(entity.Status ?? '') !== 'Invitation Declined');
    const requestedMemberIds = [session.member.memberId, ...selectedMemberIds];
    for (const memberId of requestedMemberIds) {
      if (activeRegistrations.some((entity) => this.tournamentRegistrationMemberIds(entity).includes(memberId))) {
        throw new ConflictException(memberId === session.member.memberId
          ? 'You already have an active team registration for this tournament.'
          : 'A selected member already has an active registration or invitation for this tournament.');
      }
    }
    const approvedCount = registrations.filter((entity) => this.isApprovedTournamentRegistration(String(entity.Status ?? ''))).length;
    if (approvedCount >= tournament.maxSlots) {
      throw new ConflictException('This tournament has reached its maximum number of team slots.');
    }

    const registration: TournamentRegistration = {
      tournamentId,
      registrationId: session.member.memberId,
      tournamentName: tournament.name,
      category: tournament.category,
      level: tournament.level,
      memberId: session.member.memberId,
      memberName: session.member.name,
      partnerId,
      partnerName: partner.name,
      memberExperience,
      ...(termsAcceptedAt ? { termsUrl: tournament.termsUrl, memberTermsAcceptedAt: termsAcceptedAt } : {}),
      ...(teamMembers ? { teamMembers } : {}),
      status: 'Invitation Pending',
      registeredAt: new Date().toISOString(),
    };
    const entity = this.toTournamentRegistrationEntity(registration);
    const table = this.getTournamentRegistrationsTableClient();

    try {
      if (existing) {
        await table.updateEntity({ ...entity, partitionKey: tournamentId, rowKey: session.member.memberId }, 'Replace');
      } else {
        await table.createEntity({ ...entity, partitionKey: tournamentId, rowKey: session.member.memberId });
      }
    } catch (error) {
      if (this.isAzureConflict(error)) {
        throw new ConflictException('Your team registration already exists.');
      }
      throw this.createMemberAuthenticationStorageException(error);
    }
    return registration;
  }

  async cancelTournamentRegistration(
    sessionToken: string,
    tournamentId: string,
    registrationId: string,
  ): Promise<{ deleted: true }> {
    const session = await this.getMemberSession(sessionToken);
    await this.getTournament(tournamentId);
    const table = this.getTournamentRegistrationsTableClient();
    let entity: TableEntityResult<Record<string, unknown>>;
    try {
      entity = await table.getEntity(tournamentId, registrationId);
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament registration was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
    if (!this.tournamentRegistrationMemberIds(entity).includes(session.member.memberId)) {
      throw new ForbiddenException('You are not part of this tournament team.');
    }
    if (!['Invitation Pending', 'Pending Approval', 'Approved', 'Payment Submitted'].includes(String(entity.Status ?? ''))) {
      throw new ConflictException('Only unpaid, active tournament registrations can be cancelled.');
    }
    try {
      await table.deleteEntity(tournamentId, registrationId, { etag: entity.etag });
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament registration was not found.');
      if (this.isTournamentRegistrationVersionConflict(error)) {
        throw new ConflictException('The registration changed. Refresh and check its payment status before cancelling.');
      }
      throw this.createMemberAuthenticationStorageException(error);
    }
    return { deleted: true };
  }

  async respondToTournamentInvitation(
    sessionToken: string,
    tournamentId: string,
    registrationId: string,
    decision: 'Accepted' | 'Declined',
    partnerExperienceInput?: unknown,
    termsAccepted?: unknown,
  ): Promise<TournamentRegistration> {
    const session = await this.getMemberSession(sessionToken);
    if (decision !== 'Accepted' && decision !== 'Declined') {
      throw new BadRequestException('Choose whether to accept or decline the invitation.');
    }
    const tournament = await this.getTournament(tournamentId);
    const table = this.getTournamentRegistrationsTableClient();
    let entity: Record<string, unknown>;
    try {
      entity = await table.getEntity(tournamentId, registrationId);
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament invitation was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
    const teamMembers = this.readTournamentTeamMembers(entity);
    const teamInvitee = teamMembers.find((member) => member.memberId === session.member.memberId);
    const canRespond = teamMembers.length
      ? teamInvitee && !teamInvitee.accepted && teamInvitee.memberId !== String(entity.MemberId ?? '')
      : String(entity.PartnerId ?? '') === session.member.memberId;
    if (!canRespond || String(entity.Status ?? '') !== 'Invitation Pending') {
      throw new ForbiddenException('This invitation is not available to your account.');
    }
    if (decision === 'Accepted') {
      this.requireOpenTournamentRegistration(tournament);
      this.requireTournamentTermsAgreement(tournament, termsAccepted);
      const termsAcceptedAt = tournament.termsUrl ? new Date().toISOString() : undefined;
      const partnerExperience = this.validateTournamentExperience(partnerExperienceInput);
      const otherActiveRegistration = (await this.getTournamentRegistrationEntities(tournamentId)).some((candidate) =>
        String(candidate.rowKey ?? '') !== registrationId &&
        String(candidate.Status ?? '') !== 'Invitation Declined' &&
        this.tournamentRegistrationMemberIds(candidate).includes(session.member.memberId),
      );
      if (otherActiveRegistration) {
        throw new ConflictException('You already have an active team registration for this tournament.');
      }
      const primary = await this.getTournamentMember(String(entity.MemberId ?? ''));
      if (!this.isTournamentGenderEligible(tournament.category, primary.gender, session.member.gender)) {
        throw new ConflictException('Your gender no longer meets this tournament category\'s requirements.');
      }
      if (teamMembers.length) {
        const updatedTeamMembers = teamMembers.map((member) => member.memberId === session.member.memberId
          ? { ...member, accepted: true, experience: partnerExperience, ...(termsAcceptedAt ? { termsAcceptedAt } : {}) }
          : member);
        const allAccepted = updatedTeamMembers.every((member) => member.accepted);
        const status = allAccepted ? 'Pending Approval' : 'Invitation Pending';
        const teamMembersJson = JSON.stringify(updatedTeamMembers);
        await table.updateEntity({
          partitionKey: tournamentId,
          rowKey: registrationId,
          TeamMembers: teamMembersJson,
          PartnerAccepted: allAccepted,
          Status: status,
        }, 'Merge');
        return this.toTournamentRegistration({
          ...entity,
          TeamMembers: teamMembersJson,
          PartnerAccepted: allAccepted,
          Status: status,
        })!;
      }
      await table.updateEntity({
        partitionKey: tournamentId,
        rowKey: registrationId,
        PartnerAccepted: true,
        ...this.toTournamentExperienceEntity('Partner', partnerExperience),
        ...(termsAcceptedAt ? { PartnerTermsAcceptedAt: termsAcceptedAt } : {}),
        Status: 'Pending Approval',
      }, 'Merge');
      return this.toTournamentRegistration({
        ...entity,
        ...this.toTournamentExperienceEntity('Partner', partnerExperience),
        ...(termsAcceptedAt ? { PartnerTermsAcceptedAt: termsAcceptedAt } : {}),
        Status: 'Pending Approval',
      })!;
    } else {
      await table.updateEntity({
        partitionKey: tournamentId,
        rowKey: registrationId,
        PartnerAccepted: false,
        Status: 'Invitation Declined',
      }, 'Merge');
    }
    return this.toTournamentRegistration({ ...entity, Status: 'Invitation Declined' })!;
  }

  async getTournamentRegistrationsForAdmin(
    sessionToken: string,
  ): Promise<TournamentRegistration[]> {
    await this.requireAdminSession(sessionToken);
    const registrations: TournamentRegistration[] = [];
    try {
      for await (const entity of this.getTournamentRegistrationsTableClient().listEntities()) {
        const registration = this.toTournamentRegistration(entity);
        if (registration) registrations.push(registration);
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }
    return registrations.sort((left, right) => left.registeredAt.localeCompare(right.registeredAt));
  }

  async approveTournamentRegistration(
    sessionToken: string,
    tournamentId: string,
    registrationId: string,
  ): Promise<TournamentRegistration> {
    await this.requireAdminSession(sessionToken);
    const table = this.getTournamentRegistrationsTableClient();
    let entity: Record<string, unknown>;
    try {
      entity = await table.getEntity(tournamentId, registrationId);
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament registration was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
    const teamMembers = this.readTournamentTeamMembers(entity);
    const complete = teamMembers.length
      ? teamMembers.length === 4 && teamMembers.every((member) => member.accepted)
      : entity.PartnerAccepted === true;
    if (String(entity.Status ?? '') !== 'Pending Approval' || !complete) {
      throw new ConflictException('Only complete teams can be approved.');
    }
    const tournament = await this.getTournament(tournamentId);
    const registrations = await this.getTournamentRegistrationEntities(tournamentId);
    const approvedCount = registrations.filter((registration) =>
      this.isApprovedTournamentRegistration(String(registration.Status ?? '')),
    ).length;
    if (approvedCount >= tournament.maxSlots) {
      throw new ConflictException('This tournament has reached its maximum number of approved teams.');
    }
    const approvedAt = new Date().toISOString();
    await table.updateEntity({ partitionKey: tournamentId, rowKey: registrationId, Status: 'Approved', ApprovedAt: approvedAt }, 'Merge');
    return this.toTournamentRegistration({ ...entity, Status: 'Approved', ApprovedAt: approvedAt })!;
  }

  async uploadTournamentPaymentProof(
    sessionToken: string,
    tournamentId: string,
    registrationId: string,
    file: TournamentPaymentProofUploadInput,
  ): Promise<TournamentRegistration> {
    const session = await this.getMemberSession(sessionToken);
    await this.getTournament(tournamentId);
    const table = this.getTournamentRegistrationsTableClient();
    let entity = await this.getTournamentRegistrationEntity(tournamentId, registrationId);
    if (!this.tournamentRegistrationMemberIds(entity).includes(session.member.memberId)) {
      throw new ForbiddenException('You are not part of this tournament team.');
    }
    if (entity.Status === 'Paid') {
      throw new ConflictException('This registration is already paid. Only an admin can change it.');
    }
    if (!['Approved', 'Payment Submitted'].includes(String(entity.Status ?? ''))) {
      throw new ConflictException('Payment proof is available after the team registration is approved.');
    }
    const extensions: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
    };
    const extension = file.mimetype ? extensions[file.mimetype.toLowerCase()] : undefined;
    if (!extension || !file.size || file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('Payment proof must be a PDF, JPEG, or PNG file no larger than 10 MB.');
    }
    const blobName = `tournament-payment-proofs/${tournamentId}/${registrationId}/${randomUUID()}.${extension}`;
    const blockBlobClient = this.getTournamentPaymentProofBlobClient(blobName);
    try {
      await this.uploadParticipationBlob(blockBlobClient, file.buffer, file.mimetype);
    } catch (error) {
      throw this.createAzureUploadException(error, blobName);
    }
    const proof: StoredTournamentPaymentProof = {
      memberId: session.member.memberId,
      memberName: session.member.name,
      fileName: file.originalname,
      uploadedAt: new Date().toISOString(),
      blobName,
      contentType: file.mimetype!.toLowerCase(),
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // Re-read after uploading so concurrent proofs are retained and Paid cannot be overwritten.
      entity = await this.getTournamentRegistrationEntity(tournamentId, registrationId);
      if (!this.tournamentRegistrationMemberIds(entity).includes(session.member.memberId)) {
        throw new ForbiddenException('You are no longer part of this tournament team.');
      }
      if (!['Approved', 'Payment Submitted'].includes(String(entity.Status ?? ''))) {
        throw new ConflictException('The registration is no longer open for payment-proof uploads. Refresh its status.');
      }
      const proofs = this.readTournamentPaymentProofs(entity).filter((item) => item.memberId !== proof.memberId);
      const update = {
        partitionKey: tournamentId,
        rowKey: registrationId,
        Status: 'Payment Submitted',
        PaymentProofs: JSON.stringify([...proofs, proof]),
      };
      try {
        await table.updateEntity(update, 'Merge', { etag: entity.etag });
        return this.toTournamentRegistration({ ...entity, ...update })!;
      } catch (error) {
        if (this.isTournamentRegistrationVersionConflict(error)) {
          if (attempt < 2) continue;
          throw new ConflictException('The registration changed during upload. Refresh and try again.');
        }
        if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament registration was not found.');
        throw this.createMemberAuthenticationStorageException(error);
      }
    }
    throw new ConflictException('The registration changed during upload. Refresh and try again.');
  }

  async markTournamentRegistrationPaid(
    sessionToken: string,
    tournamentId: string,
    registrationId: string,
  ): Promise<TournamentRegistration> {
    const session = await this.requireAdminSession(sessionToken);
    await this.getTournament(tournamentId);
    const entity = await this.getTournamentRegistrationEntity(tournamentId, registrationId);
    if (!['Approved', 'Payment Submitted'].includes(String(entity.Status ?? ''))) {
      throw new ConflictException('Only approved registrations can be marked as paid.');
    }
    const update = {
      partitionKey: tournamentId, rowKey: registrationId,
      Status: 'Paid', PaidAt: new Date().toISOString(), PaidBy: session.member.memberId,
    };
    try {
      await this.getTournamentRegistrationsTableClient().updateEntity(update, 'Merge', { etag: entity.etag });
    } catch (error) {
      if (this.isTournamentRegistrationVersionConflict(error)) {
        throw new ConflictException('The registration changed. Refresh before marking it paid.');
      }
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament registration was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
    return this.toTournamentRegistration({ ...entity, ...update })!;
  }

  async removeTournamentRegistration(
    sessionToken: string,
    tournamentId: string,
    registrationId: string,
  ): Promise<{ deleted: true }> {
    await this.requireAdminSession(sessionToken);
    await this.getTournament(tournamentId);
    const entity = await this.getTournamentRegistrationEntity(tournamentId, registrationId);
    try {
      await this.getTournamentRegistrationsTableClient().deleteEntity(tournamentId, registrationId, { etag: entity.etag });
    } catch (error) {
      if (this.isTournamentRegistrationVersionConflict(error)) {
        throw new ConflictException('The registration changed. Refresh before removing it.');
      }
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament registration was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
    return { deleted: true };
  }

  async getTournamentPaymentProof(
    sessionToken: string,
    tournamentId: string,
    registrationId: string,
    memberId: string,
    archived = false,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const session = await this.getMemberSession(sessionToken);
    if (archived) await this.requireAdminSession(sessionToken);
    else await this.getTournament(tournamentId);
    const entity = archived
      ? await this.getArchivedTournamentChild(tournamentId, 'registrations', registrationId)
      : await this.getTournamentRegistrationEntity(tournamentId, registrationId);
    if (session.member.role !== 'admin' && !this.tournamentRegistrationMemberIds(entity).includes(session.member.memberId)) {
      throw new ForbiddenException('You are not part of this tournament team.');
    }
    const proof = this.readTournamentPaymentProofs(entity).find((item) => item.memberId === memberId);
    let blobName = proof?.blobName;
    let contentType = proof?.contentType;
    if (!proof && memberId === 'legacy' && entity.PaymentProofUrl) {
      let url: URL;
      try {
        url = new URL(String(entity.PaymentProofUrl));
      } catch {
        throw new BadGatewayException('Stored payment proof has an invalid storage location.');
      }
      const prefix = `/${this.azureContainerName}/`;
      if (url.hostname !== `${this.azureStorageAccount}.blob.core.windows.net` || !url.pathname.startsWith(prefix)) {
        throw new BadGatewayException('Stored payment proof has an invalid storage location.');
      }
      blobName = decodeURIComponent(url.pathname.slice(prefix.length));
      contentType = blobName.endsWith('.pdf') ? 'application/pdf' : blobName.endsWith('.png') ? 'image/png' : 'image/jpeg';
    }
    if (!blobName) throw new NotFoundException('Payment proof was not found.');
    if (!blobName.startsWith(`tournament-payment-proofs/${tournamentId}/${registrationId}/`)) {
      throw new BadGatewayException('Stored payment proof has an invalid storage location.');
    }
    try {
      return { buffer: await this.getTournamentPaymentProofBlobClient(blobName).downloadToBuffer(), contentType: contentType! };
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Payment-proof file was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  async setTournamentRegistrationClosed(
    sessionToken: string,
    tournamentId: string,
    closedInput: unknown,
  ): Promise<Tournament> {
    await this.requireAdminSession(sessionToken);
    if (typeof closedInput !== 'boolean') {
      throw new BadRequestException('Specify whether registration should be closed.');
    }
    const tournament = await this.getTournament(tournamentId);
    const registrationClosedAt = closedInput ? new Date().toISOString() : '';
    try {
      await this.getTournamentsTableClient().updateEntity({
        partitionKey: 'tournaments',
        rowKey: tournamentId,
        RegistrationClosed: closedInput,
        RegistrationClosedAt: registrationClosedAt,
      }, 'Merge');
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
    const counts = (await this.getTournamentRegistrationEntities(tournamentId)).map((entity) => String(entity.Status ?? ''));
    const { registrationClosedAt: _previous, ...rest } = tournament;
    return {
      ...rest,
      registrationClosed: closedInput,
      ...(closedInput ? { registrationClosedAt } : {}),
      registrationCount: counts.filter((status) => this.isApprovedTournamentRegistration(status)).length,
      pendingRegistrationCount: counts.filter((status) => status === 'Invitation Pending' || status === 'Pending Approval').length,
    };
  }

  async getTournamentRoster(sessionToken: string, tournamentId: string): Promise<TournamentRoster> {
    const session = await this.getMemberSession(sessionToken);
    const tournament = await this.getTournament(tournamentId);
    return this.getTournamentRosterForMember(tournament, session.member);
  }

  private async getTournamentRosterForMember(
    tournament: Tournament,
    member: MemberSessionResult['member'],
  ): Promise<TournamentRoster> {
    const { teams, ownRegistration } = await this.loadConfirmedTournamentRoster(
      tournament,
      member.memberId,
      member.role === 'admin',
    );
    return {
      tournamentId: tournament.tournamentId,
      tournamentName: tournament.name,
      category: tournament.category,
      level: tournament.level,
      canManageRoster: member.role === 'admin',
      teams: teams.map((team) => ({ ...team, isOwnTeam: team.registrationId === ownRegistration?.registrationId })),
    };
  }

  async getTournamentPlanning(
    sessionToken: string,
    tournamentId: string,
  ): Promise<TournamentPlanningState> {
    await this.requireAdminSession(sessionToken);
    const roster = await this.getTournamentRoster(sessionToken, tournamentId);
    const entity = await this.getTournamentPlanningEntity(tournamentId);
    const draw = await this.readTournamentDraw(tournamentId, entity);
    const rosterChanged = !!draw &&
      draw.rosterSignature !== this.tournamentRosterSignature(roster);
    return {
      roster,
      draw: rosterChanged ? null : draw,
      version: draw?.version ?? null,
      rosterChanged,
    };
  }

  async scheduleTournamentLiveDraw(
    sessionToken: string, tournamentId: string, input: {
      scheduledAt?: unknown; poolCount?: unknown; rosterFinalized?: unknown; expectedEventId?: unknown;
    },
  ): Promise<TournamentLiveDrawState> {
    const session = await this.requireAdminSession(sessionToken);
    const tournament = await this.getTournament(tournamentId);
    if (!tournament.registrationClosed) throw new ConflictException('Close registration before scheduling a live draw.');
    const roster = await this.getTournamentRosterForMember(tournament, session.member);
    const entity = await this.getTournamentPlanningEntity(tournamentId);
    const previous = await this.readTournamentLiveDraw(tournamentId, entity);
    if (input.expectedEventId !== (previous?.event.eventId ?? null)) {
      throw new ConflictException('The live event changed. Reload before scheduling.');
    }
    if (previous && previous.event.rosterSignature === this.tournamentRosterSignature(roster) &&
        !['scheduled', 'invalidated', 'final'].includes(liveDrawPhase(previous.event, Date.now()))) {
      throw new ConflictException('A live draw is in progress. Wait until it finishes.');
    }
    const scheduledAt = typeof input.scheduledAt === 'string' ? Date.parse(input.scheduledAt) : NaN;
    if (!Number.isFinite(scheduledAt) || scheduledAt < Date.now() + 60_000) {
      throw new BadRequestException('Schedule the draw at least one minute in the future.');
    }
    if (input.rosterFinalized !== true) throw new BadRequestException('Confirm that the tournament roster is finalized.');
    if (typeof input.poolCount !== 'number' || !Number.isSafeInteger(input.poolCount) ||
        input.poolCount < 1 || input.poolCount > Math.floor(roster.teams.length / 2)) {
      throw new BadRequestException('Choose a valid pool count with at least two confirmed teams per pool.');
    }
    const event: LiveDrawEvent = {
      eventId: randomUUID(), scheduledAt, poolCount: input.poolCount,
      rosterSignature: this.tournamentRosterSignature(roster),
      roster: { ...roster, teams: roster.teams.map((team) => ({ ...team, isOwnTeam: false })) },
      createdBy: session.member.memberId, presence: {}, eligibleMemberIds: null,
      rerollVoterIds: [], initialDraw: null, rerollDraw: null, invalidated: false,
    };
    const blobName = `tournament-live-draws/${tournamentId}/${event.eventId}.json`;
    try {
      await this.writeTournamentLiveDraw(blobName, event);
      await this.getTournamentsTableClient().updateEntity({
        partitionKey: 'tournaments', rowKey: tournamentId, LiveDrawBlobName: blobName,
        LiveDrawPublishedVersion: '', DrawBlobName: '',
      }, 'Merge', { etag: entity.etag });
    } catch (error) {
      if (this.isTournamentRegistrationVersionConflict(error)) throw new ConflictException('The tournament changed. Reload before scheduling.');
      throw this.liveDrawStorageException(error);
    }
    return {
      serverNow: new Date().toISOString(), canManage: true, roster,
      event: toLiveDrawView(event, session.member.memberId, Date.now()),
    };
  }

  async getTournamentLiveDraw(
    sessionToken: string, tournamentId: string,
    action: 'read' | 'presence' | 'vote' = 'read', eventId?: unknown,
  ): Promise<TournamentLiveDrawState> {
    const session = await this.getMemberSession(sessionToken);
    const tournament = await this.getTournament(tournamentId);
    const roster = await this.getTournamentRosterForMember(tournament, session.member);
    const isParticipant = roster.teams.some((team) =>
      team.players.some((player) => player.memberId === session.member.memberId),
    );
    if (!isParticipant && session.member.role !== 'admin') throw new ForbiddenException('Only confirmed participants and administrators can view the live draw.');
    const signature = this.tournamentRosterSignature(roster);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const entity = await this.getTournamentPlanningEntity(tournamentId);
      if (entity.LifecycleState) throw new ConflictException('This tournament is being archived or deleted.');
      const stored = await this.readTournamentLiveDraw(tournamentId, entity);
      const now = Date.now();
      if (!stored) {
        if (action === 'vote') throw new ConflictException('No live draw has been scheduled.');
        return { serverNow: new Date(now).toISOString(), canManage: session.member.role === 'admin', roster, event: null };
      }
      const event = stored.event;
      const before = JSON.stringify(event);
      if (!tournament.registrationClosed || signature !== event.rosterSignature) event.invalidated = true;
      advanceLiveDraw(event, now);
      if (action === 'presence' && isParticipant && liveDrawPhase(event, now) === 'scheduled') {
        event.presence[session.member.memberId] = now;
        // Keep the persisted attendance map bounded to recent participants.
        for (const [id, seenAt] of Object.entries(event.presence)) {
          if (seenAt < now - 15_000) delete event.presence[id];
        }
      }
      if (action === 'vote') {
        if (eventId !== event.eventId) throw new ConflictException('The live event changed. Reload before voting.');
        if (liveDrawPhase(event, now) !== 'voting') throw new ConflictException('The voting window is not open.');
        if (!event.eligibleMemberIds?.includes(session.member.memberId)) {
          throw new ForbiddenException('Only players present when the draw started may vote.');
        }
        // An identical retry acknowledges the original vote instead of consuming another vote.
        if (!event.rerollVoterIds.includes(session.member.memberId)) event.rerollVoterIds.push(session.member.memberId);
      }
      if (before !== JSON.stringify(event)) {
        try {
          await this.writeTournamentLiveDraw(stored.blobName, event, stored.etag);
        } catch (error) {
          if (this.isTournamentRegistrationVersionConflict(error)) {
            await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 60));
            continue;
          }
          throw this.liveDrawStorageException(error);
        }
      }
      const currentEntity = await this.getTournamentPlanningEntity(tournamentId);
      if (currentEntity.LifecycleState || currentEntity.LiveDrawBlobName !== stored.blobName) {
        throw new ConflictException('The tournament or live event changed. Reload the page.');
      }
      if (liveDrawPhase(event, now) === 'final') await this.publishTournamentLiveDraw(tournamentId, stored.blobName, event);
      return {
        serverNow: new Date(now).toISOString(), canManage: session.member.role === 'admin', roster,
        event: toLiveDrawView(event, session.member.memberId, now),
      };
    }
    throw new ConflictException('The live event is busy. Please retry; your vote is not confirmed until acknowledged.');
  }

  private async readTournamentLiveDraw(tournamentId: string, entity: Record<string, unknown>) {
    const blobName = String(entity.LiveDrawBlobName ?? '');
    if (!blobName) return null;
    if (!new RegExp(`^tournament-live-draws/${tournamentId}/[a-f0-9-]{36}\\.json$`).test(blobName)) {
      throw new BadGatewayException('Stored live draw location is invalid.');
    }
    try {
      const response = await this.getTournamentDocumentBlobClient(blobName).download();
      if (!response.readableStreamBody || !response.etag) throw new Error('Live draw storage response is incomplete.');
      const chunks: Buffer[] = [];
      for await (const chunk of response.readableStreamBody) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const event: LiveDrawEvent = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!event.eventId || !Number.isFinite(event.scheduledAt) || !Number.isInteger(event.poolCount) ||
          !event.rosterSignature || !Array.isArray(event.roster?.teams) || !event.presence ||
          typeof event.presence !== 'object' || Array.isArray(event.presence) ||
          !Object.values(event.presence).every((value) => typeof value === 'number' && Number.isFinite(value)) ||
          !(event.eligibleMemberIds === null || Array.isArray(event.eligibleMemberIds)) ||
          !Array.isArray(event.rerollVoterIds) || typeof event.invalidated !== 'boolean') {
        throw new Error('Stored live draw is invalid.');
      }
      return { event, etag: response.etag, blobName };
    } catch (error) {
      throw this.liveDrawStorageException(error);
    }
  }

  private async writeTournamentLiveDraw(blobName: string, event: LiveDrawEvent, etag?: string) {
    const body = Buffer.from(JSON.stringify(event));
    await this.getTournamentDocumentBlobClient(blobName).upload(body, body.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' },
    });
  }

  private async publishTournamentLiveDraw(tournamentId: string, eventBlobName: string, event: LiveDrawEvent) {
    const draw = event.rerollDraw ?? event.initialDraw;
    if (!draw) throw new BadGatewayException('The final live draw is missing.');
    const entity = await this.getTournamentPlanningEntity(tournamentId);
    if (entity.LifecycleState || entity.LiveDrawBlobName !== eventBlobName) {
      throw new ConflictException('The tournament or live event changed. Reload the page.');
    }
    if (entity.LiveDrawPublishedVersion === draw.version) return;
    const blobName = `tournament-draws/${tournamentId}/${draw.version}.json`;
    try {
      await this.uploadParticipationBlob(this.getTournamentDocumentBlobClient(blobName), Buffer.from(JSON.stringify(draw)), 'application/json');
      await this.getTournamentsTableClient().updateEntity({
        partitionKey: 'tournaments', rowKey: tournamentId, DrawBlobName: blobName, LiveDrawPublishedVersion: draw.version,
      }, 'Merge', { etag: entity.etag });
    } catch (error) {
      if (this.isTournamentRegistrationVersionConflict(error)) throw new ConflictException('The final draw is being saved. Reload to confirm.');
      throw this.liveDrawStorageException(error);
    }
  }

  private liveDrawStorageException(error: unknown) {
    this.logger.error('Tournament live draw storage operation failed.', error);
    return new BadGatewayException('Unable to load or save the live draw. Please reconnect and retry.');
  }

  async updateTournamentPlanning(
    sessionToken: string,
    tournamentId: string,
    action: 'pools' | 'schedule',
    count: unknown,
    expectedVersion: unknown,
  ): Promise<TournamentPlanningState> {
    const session = await this.requireAdminSession(sessionToken);
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
      throw new BadRequestException('Enter a positive whole number for pools or courts.');
    }
    const entity = await this.getTournamentPlanningEntity(tournamentId);
    const live = await this.readTournamentLiveDraw(tournamentId, entity);
    if (live && !live.event.invalidated) {
      const phase = liveDrawPhase(live.event, Date.now());
      if (action === 'pools' || phase !== 'final') {
        throw new ConflictException('Pools are controlled by the live draw. Finish the event, or reschedule it from the live draw page.');
      }
      const finalDraw = live.event.rerollDraw ?? live.event.initialDraw;
      if (!finalDraw || entity.LiveDrawPublishedVersion !== finalDraw.version) {
        throw new ConflictException('Open the live draw page to finish saving the final pools before scheduling matches.');
      }
    }
    const existing = await this.readTournamentDraw(tournamentId, entity);
    if (expectedVersion !== (existing?.version ?? null)) {
      throw new ConflictException('The saved draw changed. Reload before making changes.');
    }
    const roster = await this.getTournamentRoster(sessionToken, tournamentId);
    const signature = this.tournamentRosterSignature(roster);
    if (roster.teams.length < 2) {
      throw new BadRequestException('At least two confirmed teams are required.');
    }
    if (action === 'pools' && count > Math.floor(roster.teams.length / 2)) {
      throw new BadRequestException('Each pool must contain at least two teams.');
    }
    if (action === 'schedule' && (!existing || existing.rosterSignature !== signature)) {
      throw new ConflictException('The roster changed or no pools exist. Randomize pools first.');
    }
    const pools = action === 'pools'
      ? randomizeTournamentPools(roster.teams.map((team) => team.registrationId), count)
      : existing!.pools;
    const draw: TournamentDraw = {
      version: randomUUID(),
      rosterSignature: signature,
      pools,
      courtCount: action === 'schedule' ? count : existing?.courtCount ?? 1,
      schedule: action === 'schedule' ? generateTournamentSchedule(pools, count) : [],
      updatedAt: new Date().toISOString(),
      updatedBy: session.member.memberId,
    };
    const blobName = `tournament-draws/${tournamentId}/${draw.version}.json`;
    try {
      await this.uploadParticipationBlob(
        this.getTournamentDocumentBlobClient(blobName),
        Buffer.from(JSON.stringify(draw)),
        'application/json',
      );
      await this.getTournamentsTableClient().updateEntity(
        { partitionKey: 'tournaments', rowKey: tournamentId, DrawBlobName: blobName },
        'Merge',
        { etag: entity.etag },
      );
    } catch (error) {
      if (this.isTournamentRegistrationVersionConflict(error)) {
        throw new ConflictException('The tournament changed. Reload before saving the draw.');
      }
      throw this.createMemberAuthenticationStorageException(error);
    }
    return { roster, draw, version: draw.version, rosterChanged: false };
  }

  private async getTournamentPlanningEntity(tournamentId: string) {
    try {
      return await this.getTournamentsTableClient().getEntity<Record<string, unknown>>(
        'tournaments', tournamentId,
      );
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  private tournamentRosterSignature(roster: TournamentRoster): string {
    const teams = roster.teams.map((team) => ({
      registrationId: team.registrationId,
      players: [...team.players].sort((left, right) => left.memberId.localeCompare(right.memberId)),
    })).sort((left, right) => left.registrationId.localeCompare(right.registrationId));
    return createHash('sha256').update(JSON.stringify(teams)).digest('hex');
  }

  private async readTournamentDraw(
    tournamentId: string,
    entity: Record<string, unknown>,
  ): Promise<TournamentDraw | null> {
    const blobName = String(entity.DrawBlobName ?? '');
    if (!blobName) return null;
    if (!blobName.startsWith(`tournament-draws/${tournamentId}/`)) {
      throw new BadGatewayException('Stored tournament draw location is invalid.');
    }
    try {
      const contents = await this.getTournamentDocumentBlobClient(blobName).downloadToBuffer();
      const draw: TournamentDraw = JSON.parse(contents.toString('utf8'));
      if (!draw.version || !draw.rosterSignature || !Array.isArray(draw.pools) ||
          !Array.isArray(draw.schedule) || !Number.isInteger(draw.courtCount)) {
        throw new BadGatewayException('Stored tournament draw is invalid.');
      }
      return draw;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  async getTournamentRosterReplacementCandidates(
    sessionToken: string,
    tournamentId: string,
    registrationId: string,
    memberId: string,
    searchInput: string,
  ): Promise<TournamentPartnerSearchResult[]> {
    await this.requireAdminSession(sessionToken);
    const searchTerm = String(searchInput ?? '').trim().toLocaleLowerCase();
    if (searchTerm.length < 2) return [];

    const tournament = await this.getTournament(tournamentId);
    const registration = await this.getTournamentRegistrationEntity(
      tournamentId,
      registrationId,
    );
    this.assertConfirmedRosterPlayer(registration, memberId);
    const registrations = await this.getTournamentRegistrationEntities(tournamentId);
    const currentPlayers = await this.getTournamentRosterRegistrationPlayers(
      registration,
    );
    const committedMemberIds = new Set(
      registrations
        .filter(
          (entity) =>
            String(entity.rowKey ?? '') !== registrationId &&
            String(entity.Status ?? '') !== 'Invitation Declined',
        )
        .flatMap((entity) => this.tournamentRegistrationMemberIds(entity)),
    );
    const candidates: TournamentPartnerSearchResult[] = [];

    try {
      for await (const entity of this.getMembersTableClient().listEntities({
        queryOptions: {
          filter: "PartitionKey eq 'members' and Status eq 'Approved'",
          select: ['RowKey', 'Name', 'Gender'],
        },
      })) {
        const candidateId = String(entity.rowKey ?? '');
        const candidateName = String(entity.Name ?? '');
        const candidateGender = String(entity.Gender ?? '');
        if (
          !candidateId ||
          !candidateName ||
          !candidateName.toLocaleLowerCase().includes(searchTerm)
        ) {
          continue;
        }
        if (
          this.tournamentRegistrationMemberIds(registration).includes(
            candidateId,
          ) ||
          committedMemberIds.has(candidateId) ||
          !this.canReplaceTournamentRosterPlayer(
            tournament.category,
            currentPlayers,
            memberId,
            candidateGender,
          )
        ) {
          continue;
        }
        candidates.push({
          memberId: candidateId,
          name: candidateName,
          gender: candidateGender,
          eligible: true,
        });
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return candidates.sort((left, right) => left.name.localeCompare(right.name));
  }

  async replaceTournamentRosterPlayer(
    sessionToken: string,
    tournamentId: string,
    registrationId: string,
    memberId: string,
    replacementMemberIdInput: unknown,
  ): Promise<TournamentRosterPlayer> {
    const session = await this.requireAdminSession(sessionToken);
    const replacementMemberId = String(replacementMemberIdInput ?? '').trim();
    if (!replacementMemberId) {
      throw new BadRequestException('Choose a replacement player.');
    }

    const tournament = await this.getTournament(tournamentId);
    const table = this.getTournamentRegistrationsTableClient();
    const registration = await this.getTournamentRegistrationEntity(
      tournamentId,
      registrationId,
    );
    this.assertConfirmedRosterPlayer(registration, memberId);
    if (this.tournamentRegistrationMemberIds(registration).includes(replacementMemberId)) {
      throw new BadRequestException('Choose a player who is not already on this team.');
    }

    const registrations = await this.getTournamentRegistrationEntities(tournamentId);
    if (
      registrations.some(
        (entity) =>
          String(entity.rowKey ?? '') !== registrationId &&
          String(entity.Status ?? '') !== 'Invitation Declined' &&
          this.tournamentRegistrationMemberIds(entity).includes(
            replacementMemberId,
          ),
      )
    ) {
      throw new ConflictException(
        'The replacement player is already registered or invited for this tournament.',
      );
    }

    const replacement = await this.getTournamentMember(replacementMemberId);
    const currentPlayers = await this.getTournamentRosterRegistrationPlayers(
      registration,
    );
    if (
      !this.canReplaceTournamentRosterPlayer(
        tournament.category,
        currentPlayers,
        memberId,
        replacement.gender,
      )
    ) {
      throw new BadRequestException(
        'The replacement player does not meet this tournament category’s gender requirements.',
      );
    }

    const teamMembers = this.readTournamentTeamMembers(registration);
    const update = {
      partitionKey: tournamentId,
      rowKey: registrationId,
      RosterUpdatedAt: new Date().toISOString(),
      RosterUpdatedBy: session.member.memberId,
      ...(teamMembers.length
        ? {
            TeamMembers: JSON.stringify(
              teamMembers.map((player) =>
                player.memberId === memberId
                  ? {
                      memberId: replacementMemberId,
                      name: replacement.name,
                      gender: replacement.gender,
                      accepted: true,
                    }
                  : player,
              ),
            ),
          }
        : String(registration.MemberId ?? '') === memberId
          ? { MemberId: replacementMemberId, MemberName: replacement.name }
          : { PartnerId: replacementMemberId, PartnerName: replacement.name }),
    };
    try {
      await table.updateEntity(update, 'Merge', { etag: registration.etag });
    } catch (error) {
      if (this.isTournamentRegistrationVersionConflict(error)) {
        throw new ConflictException(
          'The roster changed. Refresh before replacing this player.',
        );
      }
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Tournament registration was not found.');
      }
      throw this.createMemberAuthenticationStorageException(error);
    }

    return {
      memberId: replacementMemberId,
      name: replacement.name,
      gender: replacement.gender,
    };
  }

  async createTournamentProtest(
    sessionToken: string,
    tournamentId: string,
    input: TournamentProtestInput,
    files: TournamentDocumentUploadInput[] | undefined,
  ): Promise<TournamentProtest> {
    const session = await this.getMemberSession(sessionToken);
    const tournament = await this.getTournament(tournamentId);
    const protestedMemberId = String(input?.protestedMemberId ?? '').trim();
    const eligibilityCategory = String(input?.eligibilityCategory ?? '').trim() as TournamentProtestCategory;
    const reason = String(input?.reason ?? '').trim();
    if (!protestedMemberId) throw new BadRequestException('Choose the player you are protesting.');
    if (!TOURNAMENT_PROTEST_CATEGORIES.includes(eligibilityCategory)) {
      throw new BadRequestException('Choose which eligibility requirement or term was not met.');
    }
    if (reason.length < 20 || reason.length > 2000) {
      throw new BadRequestException('Describe the reason for the protest in 20 to 2000 characters.');
    }
    const evidenceFiles = this.validateTournamentProtestEvidence(files);

    const { teams, ownRegistration } = await this.loadConfirmedTournamentRoster(tournament, session.member.memberId, false);
    if (!ownRegistration) throw new ForbiddenException('Only confirmed participants can file a protest.');
    if (ownRegistration.players.some((player) => player.memberId === protestedMemberId)) {
      throw new BadRequestException('You cannot protest yourself or a member of your own team.');
    }
    const protestedTeam = teams.find((team) => team.players.some((player) => player.memberId === protestedMemberId));
    const protestedPlayer = protestedTeam?.players.find((player) => player.memberId === protestedMemberId);
    if (!protestedTeam || !protestedPlayer) {
      throw new NotFoundException('The protested player is not on the tournament roster.');
    }
    const existing = await this.getTournamentProtestEntities(tournamentId);
    if (existing.some((entity) =>
      String(entity.ProtesterId ?? '') === session.member.memberId &&
      String(entity.ProtestedMemberId ?? '') === protestedMemberId &&
      String(entity.Status ?? '') === 'Open',
    )) {
      throw new ConflictException('You already have an open protest against this player.');
    }

    const protestId = randomUUID();
    const uploadedAt = new Date().toISOString();
    const storedEvidence: StoredTournamentProtestEvidence[] = [];
    try {
      for (const file of evidenceFiles) {
        const blobName = `tournament-protest-evidence/${tournamentId}/${protestId}/${randomUUID()}.${file.extension}`;
        try {
          await this.uploadParticipationBlob(this.getTournamentDocumentBlobClient(blobName), file.buffer, file.contentType);
        } catch (error) {
          throw this.createAzureUploadException(error, blobName);
        }
        storedEvidence.push({
          blobName,
          fileName: file.fileName,
          contentType: file.contentType,
          size: file.size,
          uploadedAt,
        });
      }
    } catch (error) {
      await this.deleteTournamentProtestEvidence(storedEvidence);
      throw error;
    }

    const entity = {
      partitionKey: tournamentId,
      rowKey: protestId,
      TournamentId: tournamentId,
      ProtestId: protestId,
      TournamentName: tournament.name,
      ProtesterId: session.member.memberId,
      ProtesterName: session.member.name,
      ProtesterRegistrationId: ownRegistration.registrationId,
      ProtestedMemberId: protestedMemberId,
      ProtestedMemberName: protestedPlayer.name,
      ProtestedRegistrationId: protestedTeam.registrationId,
      EligibilityCategory: eligibilityCategory,
      Reason: reason,
      EvidenceFiles: JSON.stringify(storedEvidence),
      Status: 'Open',
      CreatedAt: uploadedAt,
    };
    try {
      await this.createTournamentProtestEntity(entity);
    } catch (error) {
      await this.deleteTournamentProtestEvidence(storedEvidence);
      throw this.createMemberAuthenticationStorageException(error);
    }
    return this.toTournamentProtest(entity)!;
  }

  async getMyTournamentProtests(sessionToken: string, tournamentId: string): Promise<TournamentProtest[]> {
    const session = await this.getMemberSession(sessionToken);
    await this.getTournament(tournamentId);
    return (await this.getTournamentProtestEntities(tournamentId))
      .filter((entity) => String(entity.ProtesterId ?? '') === session.member.memberId)
      .map((entity) => this.toTournamentProtest(entity))
      .filter((protest): protest is TournamentProtest => !!protest)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getTournamentProtestsForAdmin(sessionToken: string): Promise<TournamentProtest[]> {
    await this.requireAdminSession(sessionToken);
    const protests: TournamentProtest[] = [];
    try {
      for await (const entity of this.getTournamentProtestsTableClient().listEntities()) {
        const protest = this.toTournamentProtest(entity);
        if (protest) protests.push(protest);
      }
    } catch (error) {
      if (!this.isAzureNotFound(error)) throw this.createMemberAuthenticationStorageException(error);
    }
    return protests.sort((left, right) =>
      Number(right.status === 'Open') - Number(left.status === 'Open') || right.createdAt.localeCompare(left.createdAt));
  }

  async reviewTournamentProtest(
    sessionToken: string,
    tournamentId: string,
    protestId: string,
    statusInput: unknown,
    noteInput?: unknown,
  ): Promise<TournamentProtest> {
    const session = await this.requireAdminSession(sessionToken);
    await this.getTournament(tournamentId);
    if (statusInput !== 'Upheld' && statusInput !== 'Dismissed') {
      throw new BadRequestException('Choose whether to uphold or dismiss the protest.');
    }
    const note = noteInput === undefined || noteInput === null ? '' : String(noteInput).trim();
    if (note.length > 1000) throw new BadRequestException('Review notes must be 1000 characters or fewer.');
    const entity = await this.getTournamentProtestEntity(tournamentId, protestId);
    if (String(entity.Status ?? '') !== 'Open') {
      throw new ConflictException('This protest has already been reviewed.');
    }
    const update = {
      partitionKey: tournamentId,
      rowKey: protestId,
      Status: statusInput,
      ReviewedAt: new Date().toISOString(),
      ReviewedBy: session.member.name || session.member.memberId,
      ReviewNote: note,
    };
    try {
      await this.getTournamentProtestsTableClient().updateEntity(update, 'Merge', { etag: String(entity.etag ?? '*') });
    } catch (error) {
      if (this.isTournamentRegistrationVersionConflict(error)) {
        throw new ConflictException('The protest changed. Refresh before reviewing it.');
      }
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament protest was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
    return this.toTournamentProtest({ ...entity, ...update })!;
  }

  async getTournamentProtestEvidence(
    sessionToken: string,
    tournamentId: string,
    protestId: string,
    indexInput: number,
    archived = false,
  ): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const session = await this.getMemberSession(sessionToken);
    if (archived) await this.requireAdminSession(sessionToken);
    else await this.getTournament(tournamentId);
    const entity = archived
      ? await this.getArchivedTournamentChild(tournamentId, 'protests', protestId)
      : await this.getTournamentProtestEntity(tournamentId, protestId);
    if (session.member.role !== 'admin' && String(entity.ProtesterId ?? '') !== session.member.memberId) {
      throw new ForbiddenException('Only administrators and the protest author can view this evidence.');
    }
    const evidence = this.readTournamentProtestEvidence(entity)[indexInput];
    if (!Number.isInteger(indexInput) || !evidence) throw new NotFoundException('Protest evidence was not found.');
    if (!evidence.blobName.startsWith(`tournament-protest-evidence/${tournamentId}/${protestId}/`)) {
      throw new BadGatewayException('Stored protest evidence has an invalid storage location.');
    }
    try {
      return {
        buffer: await this.getTournamentDocumentBlobClient(evidence.blobName).downloadToBuffer(),
        contentType: evidence.contentType,
        fileName: evidence.fileName,
      };
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Protest evidence file was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  async createClub(
    sessionToken: string,
    nameInput: string,
  ): Promise<ClubCreateResult> {
    const session = await this.getMemberSession(sessionToken);
    if (session.member.role !== 'admin') {
      throw new ForbiddenException('Administrator access is required.');
    }

    const name = nameInput.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 100) {
      throw new BadRequestException(
        'Club name must contain between 2 and 100 characters.',
      );
    }

    const clubId = name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
    if (!clubId) {
      throw new BadRequestException(
        'Club name must contain letters or numbers.',
      );
    }

    const createdAt = new Date().toISOString();
    try {
      await this.getClubsTableClient().createEntity({
        partitionKey: 'clubs',
        rowKey: clubId,
        ClubId: clubId,
        Name: name,
        CreatedAt: createdAt,
        CreatedBy: session.member.memberId,
      });
    } catch (error) {
      if (this.isAzureConflict(error)) {
        throw new ConflictException('A club with this name already exists.');
      }
      throw this.createMemberAuthenticationStorageException(error);
    }

    return { clubId, name, createdAt };
  }

  async getMyClubJoinRequests(
    sessionToken: string,
  ): Promise<ClubJoinRequest[]> {
    const session = await this.getMemberSession(sessionToken);
    const requests: ClubJoinRequest[] = [];
    try {
      const entities = this.getClubJoinRequestsTableClient().listEntities({
        queryOptions: { filter: `RowKey eq '${session.member.memberId}'` },
      });
      for await (const entity of entities) {
        const clubId = String(entity.ClubId ?? entity.partitionKey ?? '');
        const status = String(
          entity.Status ?? 'Pending',
        ) as ClubJoinRequestStatus;
        if (!clubId || !this.isClubJoinRequestStatus(status)) continue;
        requests.push({
          clubId,
          memberId: session.member.memberId,
          memberName: session.member.name,
          status,
          requestedAt: String(entity.RequestedAt ?? ''),
          ...(entity.ReviewedAt
            ? { reviewedAt: String(entity.ReviewedAt) }
            : {}),
          ...(entity.ReviewedBy
            ? { reviewedBy: String(entity.ReviewedBy) }
            : {}),
        });
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }
    return requests;
  }

  async requestToJoinClub(
    sessionToken: string,
    clubIdInput: string,
  ): Promise<ClubJoinRequest> {
    const session = await this.getMemberSession(sessionToken);
    const clubId = clubIdInput.trim();
    if (!clubId || !/^[A-Za-z0-9_-]{1,200}$/.test(clubId)) {
      throw new BadRequestException('Invalid club identifier.');
    }
    await this.assertClubExists(clubId);

    try {
      await this.getClubMembersTableClient().getEntity(
        clubId,
        session.member.memberId,
      );
      throw new ConflictException('You are already a member of this club.');
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (!this.isAzureNotFound(error)) {
        throw this.createMemberAuthenticationStorageException(error);
      }
    }

    const requests = this.getClubJoinRequestsTableClient();
    try {
      const existing = await requests.getEntity(
        clubId,
        session.member.memberId,
      );
      if (String(existing.Status ?? 'Pending') === 'Pending') {
        throw new ConflictException(
          'Your request to join this club is already pending.',
        );
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (!this.isAzureNotFound(error)) {
        throw this.createMemberAuthenticationStorageException(error);
      }
    }

    const requestedAt = new Date().toISOString();
    try {
      await requests.upsertEntity(
        {
          partitionKey: clubId,
          rowKey: session.member.memberId,
          ClubId: clubId,
          MemberId: session.member.memberId,
          MemberName: session.member.name,
          Status: 'Pending',
          RequestedAt: requestedAt,
        },
        'Replace',
      );
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }
    return {
      clubId,
      memberId: session.member.memberId,
      memberName: session.member.name,
      status: 'Pending',
      requestedAt,
    };
  }

  async getPendingClubJoinRequests(
    sessionToken: string,
    clubId: string,
  ): Promise<ClubJoinRequest[]> {
    const actor = await this.getMemberSession(sessionToken);
    await this.assertCanManageClub(actor.member, clubId);
    const requests: ClubJoinRequest[] = [];
    try {
      const entities = this.getClubJoinRequestsTableClient().listEntities({
        queryOptions: {
          filter: `PartitionKey eq '${clubId}' and Status eq 'Pending'`,
        },
      });
      for await (const entity of entities) {
        const memberId = String(entity.MemberId ?? entity.rowKey ?? '');
        if (!memberId) continue;
        requests.push({
          clubId,
          memberId,
          memberName: String(entity.MemberName ?? 'Member'),
          status: 'Pending',
          requestedAt: String(entity.RequestedAt ?? ''),
        });
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }
    return requests.sort((left, right) =>
      left.requestedAt.localeCompare(right.requestedAt),
    );
  }

  async reviewClubJoinRequest(
    sessionToken: string,
    clubId: string,
    memberId: string,
    decision: 'Approved' | 'Rejected',
  ): Promise<ClubJoinRequest> {
    const actor = await this.getMemberSession(sessionToken);
    await this.assertCanManageClub(actor.member, clubId);
    this.validateMemberId(memberId);
    if (decision !== 'Approved' && decision !== 'Rejected') {
      throw new BadRequestException('Decision must be Approved or Rejected.');
    }

    const requests = this.getClubJoinRequestsTableClient();
    let request: Record<string, unknown>;
    try {
      request = await requests.getEntity(clubId, memberId);
    } catch (error) {
      if (this.isAzureNotFound(error))
        throw new NotFoundException('Join request was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
    if (String(request.Status ?? 'Pending') !== 'Pending') {
      throw new ConflictException(
        'This join request has already been reviewed.',
      );
    }

    const reviewedAt = new Date().toISOString();
    if (decision === 'Approved') {
      await this.getClubMembersTableClient().upsertEntity(
        {
          partitionKey: clubId,
          rowKey: memberId,
          ClubId: clubId,
          MemberId: memberId,
          Role: 'Member',
          JoinedAt: reviewedAt,
        },
        'Merge',
      );
    }

    try {
      await requests.updateEntity(
        {
          partitionKey: clubId,
          rowKey: memberId,
          Status: decision,
          ReviewedAt: reviewedAt,
          ReviewedBy: actor.member.memberId,
        },
        'Merge',
      );
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return {
      clubId,
      memberId,
      memberName: String(request.MemberName ?? 'Member'),
      status: decision,
      requestedAt: String(request.RequestedAt ?? ''),
      reviewedAt,
      reviewedBy: actor.member.memberId,
    };
  }

  async getClubAssignments(
    sessionToken: string,
  ): Promise<ClubMemberAssignment[]> {
    await this.requireAdminSession(sessionToken);
    const assignments: ClubMemberAssignment[] = [];

    try {
      const entities = this.getClubMembersTableClient().listEntities();
      for await (const entity of entities) {
        const clubId = String(
          entity.ClubId ?? entity.partitionKey ?? '',
        ).trim();
        const memberId = String(entity.MemberId ?? entity.rowKey ?? '').trim();
        if (clubId && memberId) {
          const role = String(entity.Role ?? 'Member');
          assignments.push({
            clubId,
            memberId,
            role: role === 'Officer' ? 'Officer' : 'Member',
          });
        }
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return assignments;
  }

  async assignMemberToClub(
    sessionToken: string,
    clubId: string,
    memberId: string,
    roleInput = 'Member',
  ): Promise<ClubMemberAssignment> {
    const session = await this.getMemberSession(sessionToken);
    this.validateMemberId(memberId);
    if (!clubId.trim()) throw new BadRequestException('Club is required.');
    if (roleInput !== 'Officer' && roleInput !== 'Member') {
      throw new BadRequestException('Club role must be Member or Officer.');
    }
    if (session.member.role === 'admin') {
      await this.assertClubExists(clubId.trim());
    } else {
      if (roleInput === 'Officer') {
        throw new ForbiddenException(
          'Only administrators can assign club officers.',
        );
      }
      await this.assertCanManageClub(session.member, clubId.trim());
    }
    const role = roleInput;
    const assignment: ClubMemberAssignment = {
      clubId: clubId.trim(),
      memberId,
      role,
    };

    try {
      await this.getClubMembersTableClient().upsertEntity(
        {
          partitionKey: assignment.clubId,
          rowKey: assignment.memberId,
          ClubId: assignment.clubId,
          MemberId: assignment.memberId,
          Role: assignment.role,
        },
        'Merge',
      );
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return assignment;
  }

  async removeMemberFromClub(
    sessionToken: string,
    clubId: string,
    memberId: string,
  ): Promise<{ deleted: true }> {
    await this.requireAdminSession(sessionToken);
    try {
      await this.getClubMembersTableClient().deleteEntity(clubId, memberId);
    } catch (error) {
      if (!this.isAzureNotFound(error)) {
        throw this.createMemberAuthenticationStorageException(error);
      }
    }
    return { deleted: true };
  }

  async getOfficerClubs(sessionToken: string): Promise<ClubSummary[]> {
    const session = await this.getMemberSession(sessionToken);
    if (session.member.role === 'admin') {
      return this.getClubs(sessionToken);
    }

    const clubIds: string[] = [];
    try {
      const memberships = this.getClubMembersTableClient().listEntities({
        queryOptions: {
          filter: `RowKey eq '${session.member.memberId}'`,
        },
      });
      for await (const membership of memberships) {
        const role = String(membership.Role ?? '').trim().toLowerCase();
        if (
          role === 'officer' ||
          role === 'owner' ||
          role === 'club-owner'
        ) {
          const clubId = String(
            membership.ClubId ?? membership.partitionKey ?? '',
          ).trim();
          if (clubId) clubIds.push(clubId);
        }
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    if (!clubIds.length) return [];
    const clubs = await this.getClubs(sessionToken);
    const officerClubIds = new Set(clubIds);
    return clubs.filter((club) => officerClubIds.has(club.clubId));
  }

  async getClubMembersForProfileValidation(
    sessionToken: string,
    clubId: string,
  ): Promise<ClubMemberProfileValidation[]> {
    const session = await this.getMemberSession(sessionToken);
    await this.assertCanManageClub(session.member, clubId);
    const [members, validations] = await Promise.all([
      this.getMemberDirectory(sessionToken, '', clubId),
      this.getPlayerProfileValidationsForClub(clubId),
    ]);
    const validationsByMember = new Map<string, PlayerProfileValidation[]>();
    for (const validation of validations) {
      const memberValidations =
        validationsByMember.get(validation.memberId) ?? [];
      const { memberId: _memberId, ...profileValidation } = validation;
      memberValidations.push(profileValidation);
      validationsByMember.set(validation.memberId, memberValidations);
    }

    return members.map((member) => ({
      ...member,
      validations: validationsByMember.get(member.memberId) ?? [],
    }));
  }

  async validateClubMemberProfile(
    sessionToken: string,
    clubId: string,
    memberId: string,
  ): Promise<PlayerProfileValidation> {
    const session = await this.getMemberSession(sessionToken);
    await this.assertCanManageClub(session.member, clubId);
    this.validateMemberId(memberId);
    if (memberId === session.member.memberId) {
      throw new ForbiddenException(
        'You cannot validate your own player profile.',
      );
    }

    try {
      await this.getClubMembersTableClient().getEntity(clubId, memberId);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Player is not a member of this club.');
      }
      throw this.createMemberAuthenticationStorageException(error);
    }

    const clubName = await this.getClubName(clubId);
    const validatedAt = new Date().toISOString();
    try {
      await this.getPlayerReviewsTableClient().upsertEntity(
        {
          partitionKey: clubId,
          rowKey: `${memberId}:${session.member.memberId}`,
          PlayerId: memberId,
          OfficerId: session.member.memberId,
          OfficerName: session.member.name,
          ClubId: clubId,
          ClubName: clubName,
          ValidatedAt: validatedAt,
        },
        'Replace',
      );
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return {
      officerName: session.member.name,
      clubName,
      validatedAt,
    };
  }

  async getMemberProfileValidations(
    sessionToken: string,
    memberId: string,
  ): Promise<PlayerProfileValidation[]> {
    await this.getMemberSession(sessionToken);
    this.validateMemberId(memberId);
    return (await this.getPlayerProfileValidations(memberId)).map(
      ({ memberId: _memberId, ...validation }) => validation,
    );
  }

  async getMemberProfile(memberId: string): Promise<AuthenticatedMember> {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(memberId)) {
      throw new BadRequestException('Invalid member identifier.');
    }

    try {
      const member = await this.getMembersTableClient().getEntity(
        'members',
        memberId,
      );

      return this.toAuthenticatedMember(memberId, member);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Member profile was not found.');
      }

      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  async getMemberAccount(memberId: string): Promise<MemberAccountDetails> {
    try {
      const member = await this.getMembersTableClient().getEntity(
        'members',
        memberId,
      );

      return this.toMemberAccountDetails(memberId, member);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Member account was not found.');
      }

      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  async updateMemberRole(
    actorSessionToken: string,
    memberId: string,
    roleInput: string,
  ): Promise<MemberRoleUpdateResult> {
    const actorSession = await this.getMemberSession(actorSessionToken);
    if (actorSession.member.role !== 'admin') {
      throw new ForbiddenException(
        'Only administrators can assign member roles.',
      );
    }

    if (!/^[A-Za-z0-9_-]{1,200}$/.test(memberId)) {
      throw new BadRequestException('Invalid member identifier.');
    }

    const role = roleInput.trim().toLowerCase();
    if (!MEMBER_ROLES.includes(role as MemberRole)) {
      throw new BadRequestException('Invalid member role.');
    }

    const tableClient = this.getMembersTableClient();
    try {
      await tableClient.updateEntity(
        { partitionKey: 'members', rowKey: memberId, Role: role },
        'Merge',
      );
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Member account was not found.');
      }

      throw this.createMemberAuthenticationStorageException(error);
    }

    return { memberId, role: role as MemberRole };
  }

  async getPendingMemberRegistrations(
    actorSessionToken: string,
  ): Promise<PendingMemberRegistration[]> {
    await this.requireAdminSession(actorSessionToken);
    const registrations: PendingMemberRegistration[] = [];

    try {
      const entities = this.getMembersTableClient().listEntities({
        queryOptions: {
          filter: "PartitionKey eq 'members' and Status eq 'Pending'",
          select: ['RowKey', 'Name', 'Email', 'CreatedAt', 'EmailValidated'],
        },
      });

      for await (const entity of entities) {
        const memberId = String(entity.rowKey ?? '');
        if (!memberId) continue;
        registrations.push({
          memberId,
          name: String(entity.Name ?? ''),
          email: String(entity.Email ?? ''),
          createdAt: String(entity.CreatedAt ?? ''),
          emailValidated: entity.EmailValidated === true,
        });
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return registrations.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  async approveMemberRegistration(
    actorSessionToken: string,
    memberId: string,
  ): Promise<MemberRegistrationApprovalResult> {
    await this.requireAdminSession(actorSessionToken);
    this.validateMemberId(memberId);
    const tableClient = this.getMembersTableClient();
    let member: Record<string, unknown>;

    try {
      member = await tableClient.getEntity('members', memberId);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Member account was not found.');
      }
      throw this.createMemberAuthenticationStorageException(error);
    }

    if (member.EmailValidated !== true) {
      throw new ConflictException(
        'The member must verify their email before approval.',
      );
    }

    try {
      await tableClient.updateEntity(
        {
          partitionKey: 'members',
          rowKey: memberId,
          Status: 'Approved',
          ApprovedAt: new Date().toISOString(),
        },
        'Merge',
      );
      await this.sendRegistrationApprovedEmail(
        String(member.Email ?? ''),
        String(member.Name ?? 'Member'),
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadGatewayException(
        'Registration was approved, but the approval email could not be sent.',
      );
    }

    return { memberId, status: 'Approved' };
  }

  async getBalanceTypes(sessionToken: string): Promise<string[]> {
    await this.requireBalanceManagerSession(sessionToken);
    const types = new Set<string>();

    try {
      const entities = this.getBalanceTypesTableClient().listEntities({
        queryOptions: {
          filter: "PartitionKey eq 'BalanceType'",
          select: ['Type'],
        },
      });

      for await (const entity of entities) {
        const type = String(entity.Type ?? '').trim();
        if (type) {
          types.add(type);
        }
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return [...types].sort((left, right) => left.localeCompare(right));
  }

  async getMemberBalances(
    sessionToken: string,
    memberId: string,
  ): Promise<MemberBalance[]> {
    await this.requireBalanceManagerSession(sessionToken);
    this.validateMemberId(memberId);

    return this.readMemberBalances(memberId);
  }

  async getMyMemberBalances(sessionToken: string): Promise<MemberBalance[]> {
    const session = await this.getMemberSession(sessionToken);
    return this.readMemberBalances(session.member.memberId);
  }

  private async readMemberBalances(memberId: string): Promise<MemberBalance[]> {
    this.validateMemberId(memberId);

    try {
      const entities = this.getBalancesTableClient().listEntities({
        queryOptions: {
          filter: `PartitionKey eq '${memberId}'`,
          select: [
            'RowKey',
            'PartitionKey',
            'BalanceType',
            'Type',
            'BalanceDate',
            'Amount',
          ],
        },
      });
      const balances: MemberBalance[] = [];

      for await (const entity of entities) {
        const amount = Number(entity.Amount);
        const balanceType = String(
          entity.BalanceType ?? entity.Type ?? '',
        ).trim();
        const balanceDate = String(entity.BalanceDate ?? '').trim();
        if (entity.rowKey && balanceType && Number.isFinite(amount)) {
          balances.push({
            balanceId: String(entity.rowKey),
            memberId,
            balanceType,
            balanceDate,
            amount,
          });
        }
      }

      return balances.sort((left, right) =>
        `${right.balanceDate}-${right.balanceType}`.localeCompare(
          `${left.balanceDate}-${left.balanceType}`,
        ),
      );
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  async createMemberBalance(
    sessionToken: string,
    memberId: string,
    input: MemberBalanceInput,
  ): Promise<MemberBalance> {
    await this.requireBalanceManagerSession(sessionToken);
    this.validateMemberId(memberId);
    const balance = await this.validateBalanceInput(input);
    const balanceId = randomUUID();

    try {
      await this.getBalancesTableClient().createEntity({
        partitionKey: memberId,
        rowKey: balanceId,
        MemberId: memberId,
        BalanceType: balance.balanceType,
        BalanceDate: balance.balanceDate,
        Amount: balance.amount,
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
      });
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return { balanceId, memberId, ...balance };
  }

  async updateMemberBalance(
    sessionToken: string,
    memberId: string,
    balanceId: string,
    input: MemberBalanceInput,
  ): Promise<MemberBalance> {
    await this.requireBalanceManagerSession(sessionToken);
    this.validateMemberId(memberId);
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(balanceId)) {
      throw new BadRequestException('Invalid balance identifier.');
    }

    const balance = await this.validateBalanceInput(input);
    try {
      await this.getBalancesTableClient().updateEntity(
        {
          partitionKey: memberId,
          rowKey: balanceId,
          MemberId: memberId,
          BalanceType: balance.balanceType,
          BalanceDate: balance.balanceDate,
          Amount: balance.amount,
          UpdatedAt: new Date().toISOString(),
        },
        'Merge',
      );
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Balance was not found.');
      }

      throw this.createMemberAuthenticationStorageException(error);
    }

    return { balanceId, memberId, ...balance };
  }

  async deleteMemberBalance(
    sessionToken: string,
    memberId: string,
    balanceId: string,
  ): Promise<{ deleted: true }> {
    await this.requireBalanceManagerSession(sessionToken);
    this.validateMemberId(memberId);
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(balanceId)) {
      throw new BadRequestException('Invalid balance identifier.');
    }

    try {
      await this.getBalancesTableClient().deleteEntity(memberId, balanceId);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Balance was not found.');
      }

      throw this.createMemberAuthenticationStorageException(error);
    }

    return { deleted: true };
  }

  async getMemberBalanceReminderStatus(
    sessionToken: string, memberId: string,
  ): Promise<{ nextAllowedAt: string | null }> {
    await this.requireBalanceManagerSession(sessionToken);
    this.validateMemberId(memberId);
    const reminder = await this.readBalanceReminder(memberId);
    return { nextAllowedAt: reminder ? String(reminder.NextAllowedAt) : null };
  }

  async remindMemberBalances(
    sessionToken: string, memberId: string,
  ): Promise<{ sent: true; nextAllowedAt: string }> {
    const session = await this.requireBalanceManagerSession(sessionToken);
    this.validateMemberId(memberId);
    const table = this.getMembersTableClient();
    let member: Record<string, unknown>;
    try {
      member = await table.getEntity('members', memberId);
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Member account was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
    const email = String(member.Email ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('This member does not have a valid email address.');
    }
    const balances = await this.readMemberBalances(memberId);
    const total = balances.reduce((sum, balance) => sum + Math.round(balance.amount * 100), 0) / 100;
    if (!balances.length || total <= 0) {
      throw new BadRequestException('This member has no unpaid balance to remind.');
    }
    const previous = await this.readBalanceReminder(memberId);
    const now = Date.now();
    if (previous && Date.parse(String(previous.NextAllowedAt)) > now) {
      throw new ConflictException(`A reminder was already triggered. You can send another after ${previous.NextAllowedAt}.`);
    }
    const nextAllowedAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const reservation = {
      partitionKey: 'balance-reminders', rowKey: memberId,
      TriggeredAt: new Date(now).toISOString(), NextAllowedAt: nextAllowedAt,
      TriggeredBy: session.member.memberId,
    };
    try {
      // Reserve before contacting email delivery: even uncertain delivery must not send twice.
      if (previous) await table.updateEntity(reservation, 'Replace', { etag: previous.etag });
      else await table.createEntity(reservation);
    } catch (error) {
      if (this.isTournamentRegistrationVersionConflict(error) || this.isAzureConflict(error)) {
        throw new ConflictException('Another staff member already triggered this reminder. Reload the reminder status.');
      }
      throw this.createMemberAuthenticationStorageException(error);
    }
    const name = String(member.Name ?? 'Member');
    const money = (amount: number) => `PHP ${amount.toFixed(2)}`;
    const lines = balances.map((balance) =>
      `${balance.balanceDate || 'Date unavailable'} | ${balance.balanceType} | ${money(balance.amount)}`);
    const rows = balances.map((balance) =>
      `<tr><td>${this.escapeHtml(balance.balanceDate || 'Date unavailable')}</td><td>${this.escapeHtml(balance.balanceType)}</td><td>${money(balance.amount)}</td></tr>`).join('');
    try {
      await this.sendEmail(
        email,
        'Your Sorsogon Pickleball Arena unpaid balances',
        `Hello ${name},\n\nHere are all your current unpaid balance records (including any credits):\n\n${lines.join('\n')}\n\nTotal outstanding: ${money(total)}\n\nView your balances: ${this.publicAppUrl}/my-balances\n\nPlease contact the Arena staff if you have already settled these balances.`,
        `<p>Hello ${this.escapeHtml(name)},</p><p>Here are all your current unpaid balance records (including any credits):</p><table><thead><tr><th>Date</th><th>Balance type</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><p><strong>Total outstanding: ${money(total)}</strong></p><p><a href="${this.escapeHtml(`${this.publicAppUrl}/my-balances`)}">View your balances</a></p><p>Please contact the Arena staff if you have already settled these balances.</p>`,
      );
    } catch (error) {
      this.logger.error('Balance reminder email delivery could not be confirmed.', error);
      throw new BadGatewayException(`Reminder delivery could not be confirmed. To avoid duplicate emails, the next attempt is allowed after ${nextAllowedAt}.`);
    }
    return { sent: true, nextAllowedAt };
  }

  private async readBalanceReminder(memberId: string) {
    try {
      const entity = await this.getMembersTableClient().getEntity<Record<string, unknown>>('balance-reminders', memberId);
      if (!Number.isFinite(Date.parse(String(entity.NextAllowedAt))) || !entity.etag) {
        throw new Error('Invalid balance reminder record.');
      }
      return entity;
    } catch (error) {
      if (this.isAzureNotFound(error)) return null;
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  async requestEmailVerification(
    memberId: string,
  ): Promise<EmailVerificationRequestResult> {
    const tableClient = this.getMembersTableClient();
    let member: Record<string, unknown>;

    try {
      member = await tableClient.getEntity('members', memberId);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Member account was not found.');
      }

      throw this.createMemberAuthenticationStorageException(error);
    }

    const email = String(member.Email ?? '')
      .trim()
      .toLowerCase();
    if (!email) {
      throw new BadRequestException('Member email is not configured.');
    }

    if (member.EmailValidated === true) {
      throw new ConflictException('Email address is already verified.');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashSessionToken(token);
    const expiresAt = new Date(
      Date.now() + this.emailVerificationTtlMinutes * 60 * 1000,
    ).toISOString();

    try {
      await tableClient.createEntity({
        partitionKey: 'email-verifications',
        rowKey: tokenHash,
        MemberId: memberId,
        ExpiresAt: expiresAt,
        CreatedAt: new Date().toISOString(),
      });

      await this.sendVerificationEmail(
        email,
        String(member.Name ?? 'Member'),
        `${this.publicAppUrl}/verify-email?token=${encodeURIComponent(token)}`,
      );
    } catch (error) {
      await tableClient
        .deleteEntity('email-verifications', tokenHash)
        .catch(() => undefined);

      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error('Unable to send email verification message.', error);
      throw new BadGatewayException(
        'Unable to send the verification email. Please try again.',
      );
    }

    return { sent: true, email: this.maskEmail(email) };
  }

  async resendEmailVerification(
    emailInput: string,
  ): Promise<EmailVerificationRequestResult> {
    const email = emailInput.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw new BadRequestException('Enter a valid email address.');
    }

    const memberId = Buffer.from(email).toString('base64url');
    const tableClient = this.getMembersTableClient();
    let member: Record<string, unknown>;
    try {
      member = await tableClient.getEntity('members', memberId);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException(
          'No pending registration was found for this email address.',
        );
      }
      throw this.createMemberAuthenticationStorageException(error);
    }

    if (member.Status !== 'Pending') {
      throw new ConflictException(
        'This registration is no longer awaiting email verification.',
      );
    }
    if (member.EmailValidated === true) {
      throw new ConflictException(
        'This email address has already been verified and is awaiting approval.',
      );
    }

    try {
      const existingTokens = tableClient.listEntities({
        queryOptions: {
          filter: `PartitionKey eq 'email-verifications' and MemberId eq '${memberId}'`,
          select: ['RowKey'],
        },
      });
      for await (const token of existingTokens) {
        if (token.rowKey) {
          await tableClient.deleteEntity(
            'email-verifications',
            String(token.rowKey),
          );
        }
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return this.requestEmailVerification(memberId);
  }

  async confirmEmailVerification(
    token: string,
  ): Promise<EmailVerificationResult> {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
      throw new BadRequestException('Verification link is invalid or expired.');
    }

    const tableClient = this.getMembersTableClient();
    const tokenHash = this.hashSessionToken(token);
    let verification: Record<string, unknown>;

    try {
      verification = await tableClient.getEntity(
        'email-verifications',
        tokenHash,
      );
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new BadRequestException(
          'Verification link is invalid or expired.',
        );
      }

      throw this.createMemberAuthenticationStorageException(error);
    }

    const expiresAt = Date.parse(String(verification.ExpiresAt ?? ''));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await tableClient
        .deleteEntity('email-verifications', tokenHash)
        .catch(() => undefined);
      throw new BadRequestException('Verification link is invalid or expired.');
    }

    const memberId = String(verification.MemberId ?? '');
    try {
      await tableClient.updateEntity(
        {
          partitionKey: 'members',
          rowKey: memberId,
          EmailValidated: true,
          EmailValidatedAt: new Date().toISOString(),
        },
        'Merge',
      );
      await tableClient.deleteEntity('email-verifications', tokenHash);
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }

    return { verified: true };
  }

  async updateMemberAccount(
    memberId: string,
    input: MemberProfileUpdateInput,
    profileImage?: MemberProfileImageUploadInput,
  ): Promise<MemberAccountDetails> {
    const member = this.validateMemberProfileUpdate(input);
    const tableClient = this.getMembersTableClient();
    let existingMember: Record<string, unknown>;
    try {
      existingMember = await tableClient.getEntity('members', memberId);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Member account was not found.');
      }
      throw this.createMemberAuthenticationStorageException(error);
    }

    const playerStatsChanged = this.hasPlayerStatsChanged(
      existingMember,
      member,
    );

    const profileImageUrl = profileImage
      ? await this.uploadMemberProfileImage(memberId, profileImage)
      : undefined;

    try {
      await tableClient.updateEntity(
        {
          partitionKey: 'members',
          rowKey: memberId,
          Name: member.name,
          ContactNo: member.contactNo,
          EmergencyContact: member.emergencyContact,
          ...(member.birthday
            ? { Birthday: member.birthday }
            : { Age: member.age }),
          ShowAge: member.showAge === true,
          LocationType: member.locationType,
          Location: member.location,
          Gender: member.gender,
          DUPRId: member.duprId,
          ReclubId: member.reClubId,
          Skills: JSON.stringify(member.skills),
          UpdatedAt: new Date().toISOString(),
          ...(profileImageUrl ? { ProfileImageUrl: profileImageUrl } : {}),
        },
        'Merge',
      );

      if (playerStatsChanged) {
        await this.deletePlayerProfileValidations(memberId);
      }

      const updatedMember = await tableClient.getEntity('members', memberId);
      return this.toMemberAccountDetails(memberId, updatedMember);
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        throw new NotFoundException('Member account was not found.');
      }

      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  async logoutMember(sessionToken: string): Promise<void> {
    if (!sessionToken) {
      return;
    }

    try {
      await this.getSessionsTableClient().deleteEntity(
        'sessions',
        this.hashSessionToken(sessionToken),
      );
    } catch (error) {
      if (!this.isAzureNotFound(error)) {
        throw this.createMemberAuthenticationStorageException(error);
      }
    }
  }

  private hashSessionToken(sessionToken: string): string {
    return createHash('sha256').update(sessionToken).digest('hex');
  }

  private toAuthenticatedMember(
    memberId: string,
    entity: Record<string, unknown>,
  ): AuthenticatedMember {
    const birthday = String(entity.Birthday ?? '');
    const showAge =
      entity.ShowAge === true ||
      (entity.ShowAge === undefined && entity.Age !== undefined);
    const storedAge = birthday
      ? this.calculateAge(birthday)
      : Number(entity.Age);

    return {
      memberId,
      name: String(entity.Name ?? ''),
      age:
        showAge && storedAge !== null && Number.isFinite(storedAge)
          ? storedAge
          : null,
      ...(birthday ? { birthday } : {}),
      ...(entity.ShowAge !== undefined ? { showAge } : {}),
      gender: String(entity.Gender ?? ''),
      duprId: String(entity.DUPRId ?? ''),
      reClubId: String(entity.ReclubId ?? ''),
      profileImageUrl: String(entity.ProfileImageUrl ?? ''),
      skills: this.parseStoredMemberSkills(entity.Skills),
      createdAt: String(entity.CreatedAt ?? ''),
      emailValidated: entity.EmailValidated === true,
      role: this.getMemberRole(entity),
      ...(entity.LocationType
        ? { locationType: String(entity.LocationType) as MemberLocationType }
        : {}),
      ...(entity.Location ? { location: String(entity.Location) } : {}),
    };
  }

  private getMemberRole(entity: Record<string, unknown>): MemberRole {
    const role = String(entity.Role ?? '')
      .trim()
      .toLowerCase();
    return MEMBER_ROLES.includes(role as MemberRole)
      ? (role as MemberRole)
      : 'member';
  }

  private calculateAge(birthday: string): number | null {
    const birthDate = new Date(`${birthday}T00:00:00Z`);
    if (Number.isNaN(birthDate.getTime())) {
      return null;
    }

    const today = new Date();
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    const monthDifference = today.getUTCMonth() - birthDate.getUTCMonth();
    if (
      monthDifference < 0 ||
      (monthDifference === 0 && today.getUTCDate() < birthDate.getUTCDate())
    ) {
      age -= 1;
    }

    return age >= 0 ? age : null;
  }

  private toMemberAccountDetails(
    memberId: string,
    entity: Record<string, unknown>,
  ): MemberAccountDetails {
    return {
      ...this.toAuthenticatedMember(memberId, entity),
      email: String(entity.Email ?? ''),
      contactNo: String(entity.ContactNo ?? ''),
      emergencyContact: String(entity.EmergencyContact ?? ''),
    };
  }

  private parseStoredMemberSkills(
    value: unknown,
  ): Record<string, number | null> {
    let skills: unknown = value;

    if (typeof value === 'string') {
      try {
        skills = JSON.parse(value);
      } catch {
        return {};
      }
    }

    if (
      typeof skills !== 'object' ||
      skills === null ||
      Array.isArray(skills)
    ) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(skills).map(([name, rating]) => [
        name,
        typeof rating === 'number' && Number.isFinite(rating) ? rating : null,
      ]),
    );
  }

  private async sendVerificationEmail(
    email: string,
    memberName: string,
    verificationUrl: string,
  ) {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;
    const baseUrl = (
      process.env.MAILGUN_BASE_URL ?? 'https://api.mailgun.net'
    ).replace(/\/$/, '');
    const from = process.env.EMAIL_FROM;

    if (!apiKey || !domain || !from) {
      throw new BadRequestException(
        'Email verification delivery is not configured.',
      );
    }

    const body = new URLSearchParams({
      from,
      to: email,
      subject: 'Verify your Sorsogon Pickleball Arena email',
      text: `Hello ${memberName},\n\nVerify your email by opening this link:\n${verificationUrl}\n\nThis link expires in ${this.emailVerificationTtlMinutes} minutes and can only be used once.`,
      html: `<p>Hello ${this.escapeHtml(memberName)},</p><p>Verify your email address by opening the secure link below:</p><p><a href="${this.escapeHtml(verificationUrl)}">Verify email address</a></p><p>This link expires in ${this.emailVerificationTtlMinutes} minutes and can only be used once.</p>`,
    });

    // Mailgun HTTP API over HTTPS avoids SMTP ports that networks commonly block.
    const response = await fetch(`${baseUrl}/v3/${domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Mailgun API responded with ${response.status}: ${errorText}`,
      );
    }
  }

  private async sendRegistrationApprovedEmail(
    email: string,
    memberName: string,
  ) {
    await this.sendEmail(
      email,
      'Your Sorsogon Pickleball Arena registration is approved',
      `Hello ${memberName},\n\nYour registration has been approved. You can now sign in at ${this.publicAppUrl}/login.`,
      `<p>Hello ${this.escapeHtml(memberName)},</p><p>Your registration has been approved.</p><p><a href="${this.escapeHtml(`${this.publicAppUrl}/login`)}">Sign in to your account</a></p>`,
    );
  }

  private async sendEmail(
    email: string,
    subject: string,
    text: string,
    html: string,
  ) {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;
    const baseUrl = (
      process.env.MAILGUN_BASE_URL ?? 'https://api.mailgun.net'
    ).replace(/\/$/, '');
    const from = process.env.EMAIL_FROM;

    if (!apiKey || !domain || !from) {
      throw new BadRequestException('Email delivery is not configured.');
    }

    const body = new URLSearchParams({ from, to: email, subject, text, html });
    const response = await fetch(`${baseUrl}/v3/${domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Mailgun API responded with ${response.status}: ${errorText}`,
      );
    }
  }

  private maskEmail(email: string) {
    const [localPart, domain] = email.split('@');
    const visible = localPart.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(1, localPart.length - 2))}@${domain}`;
  }

  private escapeHtml(value: string) {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character] ?? character,
    );
  }

  private async uploadMemberProfileImage(
    memberId: string,
    file: MemberProfileImageUploadInput,
  ): Promise<string> {
    if (!this.azureStorageAccount || !this.azureContainerName) {
      throw new BadRequestException(
        'OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT and OP_PARTICIPATION_AZURE_CONTAINER are required for profile image uploads.',
      );
    }

    const supportedImageTypes: Record<string, string> = {
      'image/gif': 'gif',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const extension = file.mimetype
      ? supportedImageTypes[file.mimetype.toLowerCase()]
      : undefined;

    if (!extension) {
      throw new BadRequestException(
        'Profile image must be a JPEG, PNG, WebP, or GIF file.',
      );
    }

    if (!file.size || file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Profile image must be 5 MB or smaller.');
    }

    const blobName = `member-profile-images/${memberId}/${randomUUID()}.${extension}`;
    const blockBlobClient = new BlobServiceClient(
      `https://${this.azureStorageAccount}.blob.core.windows.net`,
      new DefaultAzureCredential(),
      {
        retryOptions: {
          maxTries: 1,
          tryTimeoutInMs: this.azureUploadTimeoutMs,
        },
      },
    )
      .getContainerClient(this.azureContainerName)
      .getBlockBlobClient(blobName);

    try {
      await this.uploadParticipationBlob(
        blockBlobClient,
        file.buffer,
        file.mimetype,
      );
    } catch (error) {
      throw this.createAzureUploadException(error, blobName);
    }

    return blockBlobClient.url;
  }

  async uploadMonthlyParticipationFiles(
    month: string,
    files: MonthlyParticipationFileUploadInput[],
  ): Promise<MonthlyParticipationUploadResult> {
    if (!this.azureStorageAccount || !this.azureContainerName) {
      throw new BadRequestException(
        'OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT and OP_PARTICIPATION_AZURE_CONTAINER are required for uploads.',
      );
    }

    const normalizedMonth = this.normalizeParticipationMonth(month);

    if (!files.length) {
      throw new BadRequestException('Select at least one file to upload.');
    }

    const containerClient = new BlobServiceClient(
      `https://${this.azureStorageAccount}.blob.core.windows.net`,
      new DefaultAzureCredential(),
      {
        retryOptions: {
          maxTries: 1,
          tryTimeoutInMs: this.azureUploadTimeoutMs,
        },
      },
    ).getContainerClient(this.azureContainerName);
    const targetPath = [this.azurePrefix, normalizedMonth]
      .filter((segment) => segment.length > 0)
      .join('/');
    const uploadedFiles: MonthlyParticipationUploadFile[] = [];

    for (const file of files) {
      const fileName = this.sanitizeBlobFileName(file.originalname);
      const blobName = [targetPath, fileName]
        .filter((segment) => segment.length > 0)
        .join('/');
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      try {
        await this.uploadParticipationBlob(
          blockBlobClient,
          file.buffer,
          file.mimetype,
        );
      } catch (error) {
        throw this.createAzureUploadException(error, blobName);
      }

      uploadedFiles.push({
        fileName,
        blobName,
        size: file.size,
      });
    }

    return {
      targetPath,
      uploadedFiles,
    };
  }

  private async uploadParticipationBlob(
    blockBlobClient: BlockBlobClient,
    buffer: Buffer,
    contentType?: string,
  ) {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      this.azureUploadTimeoutMs,
    );

    try {
      await blockBlobClient.uploadData(buffer, {
        abortSignal: abortController.signal,
        blobHTTPHeaders: {
          blobContentType: contentType || 'text/plain',
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private createAzureUploadException(error: unknown, blobName: string) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    if (/aborted|abort|timeout/i.test(errorMessage)) {
      return new RequestTimeoutException(
        `Uploading ${blobName} timed out. Check Azure authentication, network access, and storage permissions.`,
      );
    }

    return new BadRequestException(
      `Unable to upload ${blobName}: ${errorMessage}`,
    );
  }

  private getMembersTableClient(): TableClient {
    if (!this.membersAzureStorageAccount || !this.membersAzureTable) {
      throw new BadRequestException(
        'MEMBERS_AZURE_STORAGE_ACCOUNT and MEMBERS_AZURE_TABLE are required for member registration.',
      );
    }

    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.membersAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private getSessionsTableClient(): TableClient {
    if (!this.membersAzureStorageAccount || !this.sessionsAzureTable) {
      throw new BadRequestException(
        'MEMBERS_AZURE_STORAGE_ACCOUNT and MEMBERS_SESSIONS_AZURE_TABLE are required for member sessions.',
      );
    }

    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.sessionsAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private getBalancesTableClient(): TableClient {
    if (!this.membersAzureStorageAccount || !this.balancesAzureTable) {
      throw new BadRequestException(
        'MEMBERS_AZURE_STORAGE_ACCOUNT and MEMBERS_BALANCES_AZURE_TABLE are required for member balances.',
      );
    }

    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.balancesAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private getBalanceTypesTableClient(): TableClient {
    if (!this.membersAzureStorageAccount || !this.balanceTypesAzureTable) {
      throw new BadRequestException(
        'MEMBERS_AZURE_STORAGE_ACCOUNT and BALANCE_TYPES_AZURE_TABLE are required for balance types.',
      );
    }

    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.balanceTypesAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private getClubsTableClient(): TableClient {
    if (!this.membersAzureStorageAccount || !this.clubsAzureTable) {
      throw new BadRequestException('Club table configuration is required.');
    }
    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.clubsAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private getClubMembersTableClient(): TableClient {
    if (!this.membersAzureStorageAccount || !this.clubMembersAzureTable) {
      throw new BadRequestException(
        'Club member table configuration is required.',
      );
    }
    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.clubMembersAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private getClubJoinRequestsTableClient(): TableClient {
    if (!this.membersAzureStorageAccount || !this.clubJoinRequestsAzureTable) {
      throw new BadRequestException(
        'Club join request table configuration is required.',
      );
    }
    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.clubJoinRequestsAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private getPlayerReviewsTableClient(): TableClient {
    if (!this.membersAzureStorageAccount) {
      throw new BadRequestException(
        'MEMBERS_AZURE_STORAGE_ACCOUNT is required for player reviews.',
      );
    }
    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.playerReviewsAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private getTournamentsTableClient(): TableClient {
    if (!this.membersAzureStorageAccount) {
      throw new BadRequestException('MEMBERS_AZURE_STORAGE_ACCOUNT is required for tournaments.');
    }
    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.tournamentsAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private getTournamentRegistrationsTableClient(): TableClient {
    if (!this.membersAzureStorageAccount) {
      throw new BadRequestException('MEMBERS_AZURE_STORAGE_ACCOUNT is required for tournament registrations.');
    }
    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.tournamentRegistrationsAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private async getTournament(tournamentId: string): Promise<Tournament> {
    if (!/^[A-Fa-f0-9-]{36}$/.test(tournamentId)) {
      throw new BadRequestException('Invalid tournament identifier.');
    }
    try {
      const entity = await this.getTournamentsTableClient().getEntity('tournaments', tournamentId);
      if (entity.LifecycleState) throw new ConflictException('This tournament is being archived or deleted. Retry the pending action in tournament management.');
      const tournament = this.toTournament(entity);
      if (!tournament) throw new NotFoundException('Tournament was not found.');
      return tournament;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  private async getTournamentMember(memberId: string): Promise<{ name: string; gender: string }> {
    this.validateMemberId(memberId);
    try {
      const member = await this.getMembersTableClient().getEntity('members', memberId);
      if (String(member.Status ?? '') !== 'Approved') {
        throw new BadRequestException('Tournament partners must be approved members.');
      }
      return { name: String(member.Name ?? ''), gender: String(member.Gender ?? '') };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament partner was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  private async getTournamentRegistrationEntities(tournamentId: string): Promise<Record<string, unknown>[]> {
    const registrations: Record<string, unknown>[] = [];
    const entities = this.getTournamentRegistrationsTableClient().listEntities({
      queryOptions: { filter: `PartitionKey eq '${tournamentId}'` },
    });
    try {
      for await (const entity of entities) registrations.push(entity);
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }
    return registrations;
  }

  private toTournament(entity: Record<string, unknown>): Tournament | null {
    const tournamentId = String(entity.rowKey ?? '');
    const category = String(entity.Category ?? '') as TournamentCategory;
    const level = String(entity.Level ?? '') as TournamentLevel;
    const name = String(entity.Name ?? '');
    if (
      !tournamentId ||
      !name ||
      !TOURNAMENT_CATEGORIES.includes(category) ||
      !TOURNAMENT_LEVELS.includes(level)
    ) {
      return null;
    }
    return {
      tournamentId,
      name,
      category,
      level,
      maxSlots: Number(entity.MaxSlots ?? 0),
      date: String(entity.Date ?? ''),
      location: String(entity.Location ?? ''),
      registrationCount: Number(entity.ArchivedRegistrationCount ?? 0),
      pendingRegistrationCount: Number(entity.ArchivedPendingRegistrationCount ?? 0),
      registrationClosed: entity.RegistrationClosed === true,
      ...(entity.RegistrationClosed === true && entity.RegistrationClosedAt
        ? { registrationClosedAt: String(entity.RegistrationClosedAt) }
        : {}),
      createdAt: String(entity.CreatedAt ?? ''),
      ...(entity.LifecycleState ? { lifecycleState: String(entity.LifecycleState) } : {}),
      ...(entity.TermsBlobName ? {
        termsUrl: this.tournamentTermsUrl(tournamentId),
        termsFileName: String(entity.TermsFileName ?? 'Terms and conditions.pdf'),
      } : {}),
    };
  }

  private toTournamentEntity(tournament: Tournament) {
    return {
      TournamentId: tournament.tournamentId,
      Name: tournament.name,
      Category: tournament.category,
      Level: tournament.level,
      MaxSlots: tournament.maxSlots,
      Date: tournament.date,
      Location: tournament.location,
      RegistrationClosed: tournament.registrationClosed,
      CreatedAt: tournament.createdAt,
    };
  }

  private toTournamentRegistration(entity: Record<string, unknown>): TournamentRegistration | null {
    const status = String(entity.Status ?? '') as TournamentRegistrationStatus;
    const category = String(entity.Category ?? '') as TournamentCategory;
    const level = String(entity.Level ?? '') as TournamentLevel;
    const registrationId = String(entity.rowKey ?? entity.RegistrationId ?? '');
    const tournamentId = String(entity.TournamentId ?? entity.partitionKey ?? '');
    if (
      !registrationId ||
      !tournamentId ||
      !TOURNAMENT_CATEGORIES.includes(category) ||
      !TOURNAMENT_LEVELS.includes(level) ||
      !['Invitation Pending', 'Invitation Declined', 'Pending Approval', 'Approved', 'Payment Submitted', 'Paid'].includes(status)
    ) {
      return null;
    }
    return {
      tournamentId,
      registrationId,
      tournamentName: String(entity.TournamentName ?? ''),
      category,
      level,
      memberId: String(entity.MemberId ?? ''),
      memberName: String(entity.MemberName ?? ''),
      partnerId: String(entity.PartnerId ?? ''),
      partnerName: String(entity.PartnerName ?? ''),
      ...(entity.TermsRequired === true ? { termsUrl: this.tournamentTermsUrl(tournamentId) } : {}),
      ...(entity.MemberTermsAcceptedAt ? { memberTermsAcceptedAt: String(entity.MemberTermsAcceptedAt) } : {}),
      ...(entity.PartnerTermsAcceptedAt ? { partnerTermsAcceptedAt: String(entity.PartnerTermsAcceptedAt) } : {}),
      ...(this.readTournamentExperience(entity, 'Member')
        ? { memberExperience: this.readTournamentExperience(entity, 'Member') }
        : {}),
      ...(this.readTournamentExperience(entity, 'Partner')
        ? { partnerExperience: this.readTournamentExperience(entity, 'Partner') }
        : {}),
      ...(this.readTournamentTeamMembers(entity).length
        ? { teamMembers: this.readTournamentTeamMembers(entity) }
        : {}),
      status,
      registeredAt: String(entity.RegisteredAt ?? ''),
      ...(entity.ApprovedAt ? { approvedAt: String(entity.ApprovedAt) } : {}),
      ...(entity.PaymentProofUrl ? { paymentProofUrl: this.tournamentPaymentProofUrl(tournamentId, registrationId, 'legacy') } : {}),
      paymentProofs: this.readTournamentPaymentProofs(entity).map(({ blobName, contentType, ...proof }) => ({
        ...proof, url: this.tournamentPaymentProofUrl(tournamentId, registrationId, proof.memberId),
      })),
      ...(entity.PaidAt ? { paidAt: String(entity.PaidAt) } : {}),
      ...(entity.PaidBy ? { paidBy: String(entity.PaidBy) } : {}),
    };
  }

  private toTournamentRegistrationEntity(registration: TournamentRegistration) {
    return {
      TournamentId: registration.tournamentId,
      RegistrationId: registration.registrationId,
      TournamentName: registration.tournamentName,
      Category: registration.category,
      Level: registration.level,
      MemberId: registration.memberId,
      MemberName: registration.memberName,
      PartnerId: registration.partnerId,
      PartnerName: registration.partnerName,
      TermsRequired: !!registration.termsUrl,
      ...(registration.memberTermsAcceptedAt ? { MemberTermsAcceptedAt: registration.memberTermsAcceptedAt } : {}),
      ...(registration.memberExperience
        ? this.toTournamentExperienceEntity('Member', registration.memberExperience)
        : {}),
      ...(registration.partnerExperience
        ? this.toTournamentExperienceEntity('Partner', registration.partnerExperience)
        : {}),
      ...(registration.teamMembers
        ? { TeamMembers: JSON.stringify(registration.teamMembers) }
        : {}),
      Status: registration.status,
      RegisteredAt: registration.registeredAt,
      PartnerAccepted: false,
    };
  }

  private isApprovedTournamentRegistration(status: string): boolean {
    return status === 'Approved' || status === 'Payment Submitted' || status === 'Paid';
  }

  private async getTournamentRegistrationEntity(tournamentId: string, registrationId: string) {
    try {
      return await this.getTournamentRegistrationsTableClient().getEntity<Record<string, unknown>>(tournamentId, registrationId);
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament registration was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  private isTournamentRegistrationVersionConflict(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 412;
  }

  private getTournamentPaymentProofBlobClient(blobName: string): BlockBlobClient {
    return this.getTournamentDocumentBlobClient(blobName);
  }

  private getTournamentDocumentBlobClient(blobName: string): BlockBlobClient {
    return this.getTournamentDocumentContainerClient().getBlockBlobClient(blobName);
  }

  private getTournamentDocumentContainerClient() {
    if (!this.azureStorageAccount || !this.azureContainerName) {
      throw new BadRequestException('OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT and OP_PARTICIPATION_AZURE_CONTAINER are required for tournament documents.');
    }
    return new BlobServiceClient(
      `https://${this.azureStorageAccount}.blob.core.windows.net`,
      new DefaultAzureCredential(),
      { retryOptions: { maxTries: 1, tryTimeoutInMs: this.azureUploadTimeoutMs } },
    ).getContainerClient(this.azureContainerName);
  }

  private tournamentTermsUrl(tournamentId: string): string {
    return `/tournaments/${encodeURIComponent(tournamentId)}/terms`;
  }

  private requireTournamentTermsAgreement(tournament: Tournament, accepted: unknown): void {
    if (tournament.termsUrl && accepted !== true) {
      throw new BadRequestException('You must agree to the tournament terms and conditions before continuing.');
    }
  }

  private tournamentPaymentProofUrl(tournamentId: string, registrationId: string, memberId: string): string {
    return `/tournaments/${encodeURIComponent(tournamentId)}/registrations/${encodeURIComponent(registrationId)}/payment-proofs/${encodeURIComponent(memberId)}`;
  }

  private readTournamentPaymentProofs(entity: Record<string, unknown>): StoredTournamentPaymentProof[] {
    if (entity.PaymentProofs === undefined) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(entity.PaymentProofs));
    } catch {
      throw new BadGatewayException('Stored tournament payment proofs are invalid.');
    }
    if (!Array.isArray(parsed) || !parsed.every((proof: unknown): proof is StoredTournamentPaymentProof =>
      !!proof && typeof proof === 'object' &&
      'memberId' in proof && typeof proof.memberId === 'string' &&
      'memberName' in proof && typeof proof.memberName === 'string' &&
      'fileName' in proof && typeof proof.fileName === 'string' &&
      'uploadedAt' in proof && typeof proof.uploadedAt === 'string' &&
      'blobName' in proof && typeof proof.blobName === 'string' &&
      'contentType' in proof && ['application/pdf', 'image/jpeg', 'image/png'].includes(String(proof.contentType)),
    )) {
      throw new BadGatewayException('Stored tournament payment proofs are invalid.');
    }
    return parsed;
  }

  private validateTournamentExperience(input: unknown): TournamentExperienceDetails {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Answer the tournament experience questions before continuing.');
    }
    const details = input as Record<string, unknown>;
    const hasJoinedTournaments = details.hasJoinedTournaments;
    const hasWonTournaments = details.hasWonTournaments;
    const highestTournamentLevel = details.highestTournamentLevel;
    const highestWinningLevel = details.highestWinningLevel;
    const winsOrPodiums = details.winsOrPodiums;

    if (typeof hasJoinedTournaments !== 'boolean' || typeof hasWonTournaments !== 'boolean') {
      throw new BadRequestException('Answer whether you have joined and won tournaments.');
    }
    if (
      (hasJoinedTournaments && !TOURNAMENT_LEVELS.includes(highestTournamentLevel as TournamentLevel)) ||
      (!hasJoinedTournaments && highestTournamentLevel !== undefined)
    ) {
      throw new BadRequestException('Select a valid highest tournament level, or leave it blank if you have not joined a tournament.');
    }
    if (hasWonTournaments) {
      if (
        !hasJoinedTournaments ||
        !TOURNAMENT_LEVELS.includes(highestWinningLevel as TournamentLevel) ||
        !Number.isInteger(winsOrPodiums) ||
        Number(winsOrPodiums) < 1
      ) {
        throw new BadRequestException('For tournament wins, select the highest winning level and enter at least one win or podium finish.');
      }
    } else if (highestWinningLevel !== undefined || winsOrPodiums !== undefined) {
      throw new BadRequestException('Winning details can only be supplied when you have won a tournament.');
    }

    return {
      hasJoinedTournaments,
      ...(hasJoinedTournaments ? { highestTournamentLevel: highestTournamentLevel as TournamentLevel } : {}),
      hasWonTournaments,
      ...(hasWonTournaments
        ? {
            highestWinningLevel: highestWinningLevel as TournamentLevel,
            winsOrPodiums: Number(winsOrPodiums),
          }
        : {}),
    };
  }

  private toTournamentExperienceEntity(
    prefix: 'Member' | 'Partner',
    details: TournamentExperienceDetails,
  ) {
    return {
      [`${prefix}HasJoinedTournaments`]: details.hasJoinedTournaments,
      ...(details.highestTournamentLevel
        ? { [`${prefix}HighestTournamentLevel`]: details.highestTournamentLevel }
        : {}),
      [`${prefix}HasWonTournaments`]: details.hasWonTournaments,
      ...(details.highestWinningLevel
        ? { [`${prefix}HighestWinningLevel`]: details.highestWinningLevel }
        : {}),
      ...(details.winsOrPodiums !== undefined
        ? { [`${prefix}WinsOrPodiums`]: details.winsOrPodiums }
        : {}),
    };
  }

  private readTournamentExperience(
    entity: Record<string, unknown>,
    prefix: 'Member' | 'Partner',
  ): TournamentExperienceDetails | undefined {
    const hasJoinedTournaments = entity[`${prefix}HasJoinedTournaments`];
    const hasWonTournaments = entity[`${prefix}HasWonTournaments`];
    if (typeof hasJoinedTournaments !== 'boolean' || typeof hasWonTournaments !== 'boolean') {
      return undefined;
    }
    const highestTournamentLevel = entity[`${prefix}HighestTournamentLevel`];
    const highestWinningLevel = entity[`${prefix}HighestWinningLevel`];
    const winsOrPodiums = entity[`${prefix}WinsOrPodiums`];
    return {
      hasJoinedTournaments,
      ...(typeof highestTournamentLevel === 'string'
        ? { highestTournamentLevel: highestTournamentLevel as TournamentLevel }
        : {}),
      hasWonTournaments,
      ...(typeof highestWinningLevel === 'string'
        ? { highestWinningLevel: highestWinningLevel as TournamentLevel }
        : {}),
      ...(typeof winsOrPodiums === 'number' ? { winsOrPodiums } : {}),
    };
  }

  private validateTeamTournamentMemberIds(input: unknown): string[] {
    if (!Array.isArray(input) || input.length !== 3 || input.some((memberId) => typeof memberId !== 'string')) {
      throw new BadRequestException('Select exactly three other members for a Team Tournament.');
    }
    return input.map((memberId: string) => memberId.trim());
  }

  private tournamentGenderGroup(gender: string): 'male' | 'female' | null {
    const normalized = gender.trim().toLowerCase();
    if (normalized === 'male' || normalized === 'man') return 'male';
    if (normalized === 'female' || normalized === 'woman') return 'female';
    return null;
  }

  private readTournamentTeamMembers(entity: Record<string, unknown>): TournamentTeamMember[] {
    const value = entity.TeamMembers;
    if (typeof value !== 'string') return [];
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((member): member is TournamentTeamMember =>
        !!member &&
        typeof member === 'object' &&
        typeof (member as TournamentTeamMember).memberId === 'string' &&
        typeof (member as TournamentTeamMember).name === 'string' &&
        typeof (member as TournamentTeamMember).gender === 'string' &&
        typeof (member as TournamentTeamMember).accepted === 'boolean',
      );
    } catch {
      return [];
    }
  }

  private tournamentRegistrationMemberIds(entity: Record<string, unknown>): string[] {
    const teamMembers = this.readTournamentTeamMembers(entity);
    return teamMembers.length
      ? teamMembers.map((member) => member.memberId)
      : [String(entity.MemberId ?? ''), String(entity.PartnerId ?? '')];
  }

  private assertConfirmedRosterPlayer(
    registration: Record<string, unknown>,
    memberId: string,
  ): void {
    if (!this.isApprovedTournamentRegistration(String(registration.Status ?? ''))) {
      throw new ConflictException(
        'Only confirmed tournament teams can be changed from the roster.',
      );
    }
    if (!this.tournamentRegistrationMemberIds(registration).includes(memberId)) {
      throw new NotFoundException('The player is not on this tournament team.');
    }
  }

  private canReplaceTournamentRosterPlayer(
    category: TournamentCategory,
    currentPlayers: TournamentRosterPlayer[],
    memberId: string,
    replacementGender: string,
  ): boolean {
    const prospectiveTeam = currentPlayers.map((player) =>
      player.memberId === memberId
        ? { ...player, gender: replacementGender }
        : player,
    );
    if (category !== 'Team Tournament') {
      return prospectiveTeam.length === 2 &&
        this.isTournamentGenderEligible(
          category,
          prospectiveTeam[0].gender,
          prospectiveTeam[1].gender,
        );
    }
    const maleCount = prospectiveTeam.filter(
      (player) => this.tournamentGenderGroup(player.gender) === 'male',
    ).length;
    const femaleCount = prospectiveTeam.filter(
      (player) => this.tournamentGenderGroup(player.gender) === 'female',
    ).length;
    return prospectiveTeam.length === 4 && maleCount === 2 && femaleCount === 2;
  }

  private async getTournamentRosterRegistrationPlayers(
    registration: Record<string, unknown>,
  ): Promise<TournamentRosterPlayer[]> {
    const teamMembers = this.readTournamentTeamMembers(registration);
    if (teamMembers.length) {
      return teamMembers.map(({ memberId, name, gender }) => ({
        memberId,
        name,
        gender,
      }));
    }
    const memberIds = this.tournamentRegistrationMemberIds(registration).filter(
      Boolean,
    );
    return Promise.all(
      memberIds.map(async (memberId) => {
        const player = await this.getTournamentMember(memberId);
        return { memberId, name: player.name, gender: player.gender };
      }),
    );
  }

  private requireOpenTournamentRegistration(tournament: Tournament): void {
    if (tournament.registrationClosed) {
      throw new ConflictException('Registration for this tournament is closed.');
    }
  }

  private async loadConfirmedTournamentRoster(
    tournament: Tournament,
    memberId: string,
    isAdmin: boolean,
  ): Promise<{ teams: Omit<TournamentRosterTeam, 'isOwnTeam'>[]; ownRegistration?: Omit<TournamentRosterTeam, 'isOwnTeam'> }> {
    if (!tournament.registrationClosed && !isAdmin) {
      throw new ConflictException('The roster is available after registration closes.');
    }
    const confirmed = (await this.getTournamentRegistrationEntities(tournament.tournamentId))
      .filter((entity) => this.isApprovedTournamentRegistration(String(entity.Status ?? '')));
    const ownEntity = confirmed.find((entity) => this.tournamentRegistrationMemberIds(entity).includes(memberId));
    if (!ownEntity && !isAdmin) {
      throw new ForbiddenException('Only confirmed participants can view the tournament roster.');
    }
    const genderCache = new Map<string, Promise<string>>();
    const lookupGender = (playerId: string) => {
      if (!genderCache.has(playerId)) {
        genderCache.set(playerId, this.getMembersTableClient().getEntity('members', playerId)
          .then((member) => String(member.Gender ?? ''))
          .catch(() => ''));
      }
      return genderCache.get(playerId)!;
    };
    const teams = await Promise.all(confirmed.map(async (entity) => {
      const teamMembers = this.readTournamentTeamMembers(entity);
      const players: TournamentRosterPlayer[] = teamMembers.length
        ? teamMembers.map((member) => ({ memberId: member.memberId, name: member.name, gender: member.gender }))
        : await Promise.all([
          [String(entity.MemberId ?? ''), String(entity.MemberName ?? '')],
          [String(entity.PartnerId ?? ''), String(entity.PartnerName ?? '')],
        ].filter(([playerId]) => !!playerId).map(async ([playerId, name]) => ({
          memberId: playerId,
          name,
          gender: await lookupGender(playerId),
        })));
      return {
        registrationId: String(entity.rowKey ?? ''),
        status: String(entity.Status ?? '') as TournamentRegistrationStatus,
        players,
      };
    }));
    teams.sort((left, right) => (left.players[0]?.name ?? '').localeCompare(right.players[0]?.name ?? ''));
    const ownRegistration = ownEntity ? teams.find((team) => team.registrationId === String(ownEntity.rowKey ?? '')) : undefined;
    return { teams, ownRegistration };
  }

  private validateTournamentProtestEvidence(files: TournamentDocumentUploadInput[] | undefined) {
    if (!files?.length) throw new BadRequestException('Upload at least one evidence file.');
    if (files.length > 5) throw new BadRequestException('Upload no more than 5 evidence files.');
    const signatures: Record<string, { extension: string; matches: (buffer: Buffer) => boolean }> = {
      'application/pdf': { extension: 'pdf', matches: (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-' },
      'image/jpeg': { extension: 'jpg', matches: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
      'image/png': {
        extension: 'png',
        matches: (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      },
      'application/msword': {
        extension: 'doc',
        matches: (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
      },
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        extension: 'docx',
        matches: (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
      },
    };
    return files.map((file) => {
      const contentType = String(file.mimetype ?? '').toLowerCase();
      const signature = signatures[contentType];
      if (
        !signature ||
        !Buffer.isBuffer(file.buffer) ||
        !file.size ||
        file.size > 10 * 1024 * 1024 ||
        file.buffer.length !== file.size ||
        !signature.matches(file.buffer)
      ) {
        throw new BadRequestException(
          `Evidence "${file.originalname}" must be a PDF, JPEG, PNG, DOC, or DOCX file no larger than 10 MB.`,
        );
      }
      return {
        buffer: file.buffer,
        contentType,
        extension: signature.extension,
        size: file.size,
        fileName: String(file.originalname ?? `evidence.${signature.extension}`).slice(0, 200),
      };
    });
  }

  private async deleteTournamentProtestEvidence(evidence: StoredTournamentProtestEvidence[]): Promise<void> {
    await Promise.all(evidence.map(async (item) => {
      try {
        await this.getTournamentDocumentBlobClient(item.blobName).deleteIfExists();
      } catch {
        // Best-effort cleanup; the protest record was never created.
      }
    }));
  }

  private getTournamentProtestsTableClient(): TableClient {
    if (!this.membersAzureStorageAccount) {
      throw new BadRequestException('MEMBERS_AZURE_STORAGE_ACCOUNT is required for tournament protests.');
    }
    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.tournamentProtestsAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private async getTournamentProtestEntities(tournamentId: string): Promise<Record<string, unknown>[]> {
    const protests: Record<string, unknown>[] = [];
    try {
      for await (const entity of this.getTournamentProtestsTableClient().listEntities({
        queryOptions: { filter: `PartitionKey eq '${tournamentId}'` },
      })) {
        protests.push(entity);
      }
    } catch (error) {
      // The protests table is created lazily on the first protest.
      if (this.isAzureNotFound(error)) return [];
      throw this.createMemberAuthenticationStorageException(error);
    }
    return protests;
  }

  private async createTournamentProtestEntity(entity: Record<string, unknown> & { partitionKey: string; rowKey: string }) {
    const client = this.getTournamentProtestsTableClient();
    try {
      await client.createEntity(entity);
    } catch (error) {
      if (!this.isAzureNotFound(error)) throw error;
      await client.createTable();
      await client.createEntity(entity);
    }
  }

  private async getTournamentProtestEntity(tournamentId: string, protestId: string): Promise<Record<string, unknown>> {
    if (!/^[A-Fa-f0-9-]{36}$/.test(tournamentId) || !/^[A-Fa-f0-9-]{36}$/.test(protestId)) {
      throw new BadRequestException('Invalid tournament protest identifier.');
    }
    try {
      return await this.getTournamentProtestsTableClient().getEntity<Record<string, unknown>>(tournamentId, protestId);
    } catch (error) {
      if (this.isAzureNotFound(error)) throw new NotFoundException('Tournament protest was not found.');
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  private readTournamentProtestEvidence(entity: Record<string, unknown>): StoredTournamentProtestEvidence[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(entity.EvidenceFiles ?? '[]'));
    } catch {
      throw new BadGatewayException('Stored protest evidence is invalid.');
    }
    if (!Array.isArray(parsed) || !parsed.every((item: unknown): item is StoredTournamentProtestEvidence =>
      !!item && typeof item === 'object' &&
      'blobName' in item && typeof item.blobName === 'string' &&
      'fileName' in item && typeof item.fileName === 'string' &&
      'contentType' in item && typeof item.contentType === 'string' &&
      'size' in item && typeof item.size === 'number' &&
      'uploadedAt' in item && typeof item.uploadedAt === 'string',
    )) {
      throw new BadGatewayException('Stored protest evidence is invalid.');
    }
    return parsed;
  }

  private toTournamentProtest(entity: Record<string, unknown>): TournamentProtest | null {
    const tournamentId = String(entity.partitionKey ?? '');
    const protestId = String(entity.rowKey ?? '');
    const status = String(entity.Status ?? '') as TournamentProtestStatus;
    if (!tournamentId || !protestId || !['Open', 'Upheld', 'Dismissed'].includes(status)) return null;
    const base = `/tournaments/${encodeURIComponent(tournamentId)}/protests/${encodeURIComponent(protestId)}/evidence`;
    return {
      tournamentId,
      protestId,
      tournamentName: String(entity.TournamentName ?? ''),
      protesterId: String(entity.ProtesterId ?? ''),
      protesterName: String(entity.ProtesterName ?? ''),
      protesterRegistrationId: String(entity.ProtesterRegistrationId ?? ''),
      protestedMemberId: String(entity.ProtestedMemberId ?? ''),
      protestedMemberName: String(entity.ProtestedMemberName ?? ''),
      protestedRegistrationId: String(entity.ProtestedRegistrationId ?? ''),
      eligibilityCategory: String(entity.EligibilityCategory ?? 'Other') as TournamentProtestCategory,
      reason: String(entity.Reason ?? ''),
      evidence: this.readTournamentProtestEvidence(entity).map(({ blobName: _blobName, ...item }, index) => ({
        ...item,
        url: `${base}/${index}`,
      })),
      status,
      createdAt: String(entity.CreatedAt ?? ''),
      ...(entity.ReviewedAt ? { reviewedAt: String(entity.ReviewedAt) } : {}),
      ...(entity.ReviewedBy ? { reviewedBy: String(entity.ReviewedBy) } : {}),
      ...(entity.ReviewNote ? { reviewNote: String(entity.ReviewNote) } : {}),
    };
  }

  private isTournamentGenderEligible(
    category: TournamentCategory,
    firstGender: string,
    secondGender: string,
  ): boolean {
    const normalizeGender = (gender: string) => gender.trim().toLowerCase();
    const first = normalizeGender(firstGender);
    const second = normalizeGender(secondGender);
    const isMale = (gender: string) => gender === 'male' || gender === 'man';
    const isFemale = (gender: string) => gender === 'female' || gender === 'woman';
    if (category === 'Mens Doubles') return isMale(first) && isMale(second);
    if (category === 'Womens Doubles') return isFemale(first) && isFemale(second);
    if (category === 'Mixed Doubles') {
      return (isMale(first) && isFemale(second)) || (isFemale(first) && isMale(second));
    }
    return true;
  }

  private async assertClubExists(clubId: string) {
    try {
      const entities = this.getClubsTableClient().listEntities({
        queryOptions: { select: ['RowKey', 'ClubId'] },
      });
      for await (const entity of entities) {
        if (String(entity.rowKey ?? entity.ClubId ?? '') === clubId) return;
      }
      throw new NotFoundException('Club was not found.');
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  private async getClubName(clubId: string): Promise<string> {
    try {
      const clubs = this.getClubsTableClient().listEntities({
        queryOptions: { select: ['RowKey', 'ClubId', 'Name'] },
      });
      for await (const club of clubs) {
        if (String(club.ClubId ?? club.rowKey ?? '') === clubId) {
          return String(club.Name ?? clubId).trim() || clubId;
        }
      }
      throw new NotFoundException('Club was not found.');
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  private async assertCanManageClub(
    actor: AuthenticatedMember,
    clubId: string,
  ) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(clubId)) {
      throw new BadRequestException('Invalid club identifier.');
    }
    await this.assertClubExists(clubId);
    if (actor.role === 'admin') return;

    try {
      const relationship = await this.getClubMembersTableClient().getEntity(
        clubId,
        actor.memberId,
      );
      const clubRole = String(relationship.Role ?? '')
        .trim()
        .toLowerCase();
      if (
        clubRole === 'owner' ||
        clubRole === 'officer' ||
        clubRole === 'club-owner'
      ) {
        return;
      }
    } catch (error) {
      if (!this.isAzureNotFound(error)) {
        throw this.createMemberAuthenticationStorageException(error);
      }
    }
    throw new ForbiddenException('You are not an officer of this club.');
  }

  private isClubJoinRequestStatus(
    value: string,
  ): value is ClubJoinRequestStatus {
    return value === 'Pending' || value === 'Approved' || value === 'Rejected';
  }

  private getMessagesTableClient(): TableClient {
    if (!this.membersAzureStorageAccount || !this.messagesAzureTable) {
      throw new BadRequestException(
        'MEMBERS_AZURE_STORAGE_ACCOUNT and MESSAGES_AZURE_TABLE are required for chat.',
      );
    }

    return new TableClient(
      `https://${this.membersAzureStorageAccount}.table.core.windows.net`,
      this.messagesAzureTable,
      new DefaultAzureCredential(),
    );
  }

  private enforceChatRateLimit(memberId: string) {
    const now = Date.now();
    const recentSends = (this.chatRateLimits.get(memberId) ?? []).filter(
      (timestamp) => now - timestamp < 60_000,
    );
    if (recentSends.length >= 5) {
      throw new HttpException(
        'Please wait before sending another message.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recentSends.push(now);
    this.chatRateLimits.set(memberId, recentSends);

    if (this.chatRateLimits.size > 5000) {
      for (const [key, timestamps] of this.chatRateLimits) {
        if (!timestamps.some((timestamp) => now - timestamp < 60_000)) {
          this.chatRateLimits.delete(key);
        }
      }
    }
  }

  private async cleanupExpiredClubChatMessages() {
    const now = Date.now();
    if (now - this.lastChatCleanupAt < 5 * 60_000) return;
    this.lastChatCleanupAt = now;

    try {
      const expired = this.getMessagesTableClient().listEntities({
        queryOptions: {
          filter: `PartitionKey eq 'club-chat' and ExpiresAt le '${new Date(now).toISOString()}'`,
          select: ['RowKey'],
        },
      });
      let deleted = 0;
      for await (const entity of expired) {
        if (entity.rowKey) {
          await this.getMessagesTableClient()
            .deleteEntity('club-chat', String(entity.rowKey))
            .catch((error: unknown) => {
              if (!this.isAzureNotFound(error)) throw error;
            });
          deleted += 1;
        }
        if (deleted >= 100) break;
      }
    } catch (error) {
      this.logger.warn(
        `Unable to clean expired club chat messages: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async getClubMemberIds(clubId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    const entities = this.getClubMembersTableClient().listEntities({
      queryOptions: { filter: `PartitionKey eq '${clubId}'` },
    });
    for await (const entity of entities) {
      const memberId = String(entity.MemberId ?? entity.rowKey ?? '').trim();
      if (memberId) ids.add(memberId);
    }
    return ids;
  }

  private async getPlayerProfileValidations(
    memberId: string,
  ): Promise<Array<PlayerProfileValidation & { memberId: string }>> {
    const validations: Array<PlayerProfileValidation & { memberId: string }> =
      [];
    try {
      const entities = this.getPlayerReviewsTableClient().listEntities({
        queryOptions: { filter: `PlayerId eq '${memberId}'` },
      });
      for await (const entity of entities) {
        const officerName = String(entity.OfficerName ?? '').trim();
        const clubName = String(entity.ClubName ?? '').trim();
        const validatedAt = String(entity.ValidatedAt ?? '').trim();
        if (officerName && clubName && validatedAt) {
          validations.push({
            memberId,
            officerName,
            clubName,
            validatedAt,
          });
        }
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }
    return validations.sort((left, right) =>
      right.validatedAt.localeCompare(left.validatedAt),
    );
  }

  private async getPlayerProfileValidationsForClub(
    clubId: string,
  ): Promise<Array<PlayerProfileValidation & { memberId: string }>> {
    const validations: Array<PlayerProfileValidation & { memberId: string }> =
      [];
    try {
      const entities = this.getPlayerReviewsTableClient().listEntities({
        queryOptions: { filter: `PartitionKey eq '${clubId}'` },
      });
      for await (const entity of entities) {
        const memberId = String(entity.PlayerId ?? '').trim();
        const officerName = String(entity.OfficerName ?? '').trim();
        const clubName = String(entity.ClubName ?? '').trim();
        const validatedAt = String(entity.ValidatedAt ?? '').trim();
        if (memberId && officerName && clubName && validatedAt) {
          validations.push({
            memberId,
            officerName,
            clubName,
            validatedAt,
          });
        }
      }
    } catch (error) {
      throw this.createMemberAuthenticationStorageException(error);
    }
    return validations.sort((left, right) =>
      right.validatedAt.localeCompare(left.validatedAt),
    );
  }

  private hasPlayerStatsChanged(
    existingMember: Record<string, unknown>,
    updatedMember: {
      duprId: string;
      skills: Record<string, number | null>;
    },
  ): boolean {
    if (
      String(existingMember.DUPRId ?? '').trim() !==
      updatedMember.duprId.trim()
    ) {
      return true;
    }

    let existingSkills: Record<string, unknown> = {};
    try {
      const parsedSkills = JSON.parse(String(existingMember.Skills ?? '{}'));
      if (typeof parsedSkills === 'object' && parsedSkills !== null) {
        existingSkills = parsedSkills as Record<string, unknown>;
      }
    } catch {
      return true;
    }

    const skillNames = new Set([
      ...Object.keys(existingSkills),
      ...Object.keys(updatedMember.skills),
    ]);
    for (const skillName of skillNames) {
      const existingRating =
        typeof existingSkills[skillName] === 'number'
          ? existingSkills[skillName]
          : 0;
      const updatedRating =
        typeof updatedMember.skills[skillName] === 'number'
          ? updatedMember.skills[skillName]
          : 0;
      if (existingRating !== updatedRating) {
        return true;
      }
    }

    return false;
  }

  private async deletePlayerProfileValidations(memberId: string) {
    try {
      const reviews = this.getPlayerReviewsTableClient().listEntities({
        queryOptions: {
          filter: `PlayerId eq '${memberId}'`,
          select: ['PartitionKey', 'RowKey'],
        },
      });
      for await (const review of reviews) {
        if (review.partitionKey && review.rowKey) {
          await this.getPlayerReviewsTableClient().deleteEntity(
            String(review.partitionKey),
            String(review.rowKey),
          );
        }
      }
    } catch (error) {
      if (this.isAzureNotFound(error)) {
        return;
      }
      throw this.createMemberAuthenticationStorageException(error);
    }
  }

  private async requireAdminSession(sessionToken: string) {
    const session = await this.getMemberSession(sessionToken);
    if (session.member.role !== 'admin') {
      throw new ForbiddenException('Administrator access is required.');
    }
    return session;
  }

  private async requireBalanceManagerSession(sessionToken: string) {
    const session = await this.getMemberSession(sessionToken);
    if (session.member.role !== 'admin' && session.member.role !== 'balance-staff') {
      throw new ForbiddenException('Administrator or balance staff access is required.');
    }
    return session;
  }

  private validateMemberId(memberId: string) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(memberId)) {
      throw new BadRequestException('Invalid member identifier.');
    }
  }

  private async validateBalanceInput(
    input: MemberBalanceInput,
  ): Promise<{ balanceType: string; balanceDate: string; amount: number }> {
    const balanceType = String(input?.balanceType ?? '').trim();
    const balanceDate = String(input?.balanceDate ?? '').trim();
    const amount = Number(input?.amount);

    if (!balanceType || !balanceDate || !Number.isFinite(amount)) {
      throw new BadRequestException(
        'Balance type, date, and amount are required.',
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(balanceDate)) {
      throw new BadRequestException('Balance date must be a valid date.');
    }

    const [year, month, day] = balanceDate.split('-').map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) {
      throw new BadRequestException('Balance date must be a valid date.');
    }

    const balanceTypes = this.getBalanceTypesTableClient().listEntities({
      queryOptions: {
        filter: "PartitionKey eq 'BalanceType'",
        select: ['Type'],
      },
    });
    let isValidType = false;
    for await (const entity of balanceTypes) {
      if (String(entity.Type ?? '').trim() === balanceType) {
        isValidType = true;
        break;
      }
    }

    if (!isValidType) {
      throw new BadRequestException('Select a valid balance type.');
    }

    return { balanceType, balanceDate, amount };
  }

  private validateMemberRegistration(input: MemberRegistrationInput) {
    const requiredTextFields = [
      ['Name', input.name],
      ['Email', input.email],
      ['Contact number', input.contactNo],
      ['Emergency contact', input.emergencyContact],
      ['Gender', input.gender],
    ];
    const emptyField = requiredTextFields.find(
      ([, value]) => typeof value !== 'string' || !value.trim(),
    );

    const legacyAge = input.age;
    if (
      emptyField ||
      (!input.birthday &&
        (!Number.isInteger(legacyAge) ||
          legacyAge === undefined ||
          legacyAge < 1))
    ) {
      throw new BadRequestException('Complete all required member details.');
    }

    if (!['Male', 'Female'].includes(input.gender.trim())) {
      throw new BadRequestException('Choose Male or Female as your biological gender.');
    }

    if (input.birthday && !this.isValidBirthday(input.birthday)) {
      throw new BadRequestException('Enter a valid birthday.');
    }
    const location = this.validateMemberLocation(
      input.locationType,
      input.location,
    );

    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw new BadRequestException('Enter a valid email address.');
    }

    if (!input.password || input.password.length < 8) {
      throw new BadRequestException(
        'Password must contain at least 8 characters.',
      );
    }

    const skills = Object.fromEntries(
      Object.entries(input.skills ?? {}).map(([name, rating]) => {
        if (
          rating !== null &&
          (!Number.isFinite(rating) ||
            !Number.isInteger(rating) ||
            rating < 0 ||
            rating > 10)
        ) {
          throw new BadRequestException(
            `Skill rating for ${name} must be a whole number from 0 to 10.`,
          );
        }

        return [name, rating];
      }),
    );

    return {
      ...input,
      name: input.name.trim(),
      email,
      contactNo: input.contactNo.trim(),
      emergencyContact: input.emergencyContact.trim(),
      gender: input.gender.trim(),
      birthday: input.birthday?.trim() ?? '',
      showAge: input.showAge === true,
      ...location,
      duprId: input.duprId?.trim() ?? '',
      reClubId: input.reClubId?.trim() ?? '',
      profileImageUrl: input.profileImageUrl?.trim() ?? '',
      skills,
    };
  }

  private validateMemberProfileUpdate(input: MemberProfileUpdateInput) {
    const requiredTextFields = [
      ['Name', input.name],
      ['Contact number', input.contactNo],
      ['Emergency contact', input.emergencyContact],
      ['Gender', input.gender],
    ];
    const emptyField = requiredTextFields.find(
      ([, value]) => typeof value !== 'string' || !value.trim(),
    );

    const legacyAge = input.age;
    if (
      emptyField ||
      (!input.birthday &&
        (!Number.isInteger(legacyAge) ||
          legacyAge === undefined ||
          legacyAge < 1))
    ) {
      throw new BadRequestException('Complete all required member details.');
    }

    if (input.birthday && !this.isValidBirthday(input.birthday)) {
      throw new BadRequestException('Enter a valid birthday.');
    }
    const location = this.validateMemberLocation(
      input.locationType,
      input.location,
    );

    const skills = Object.fromEntries(
      Object.entries(input.skills ?? {}).map(([name, rating]) => {
        if (
          rating !== null &&
          (!Number.isFinite(rating) ||
            !Number.isInteger(rating) ||
            rating < 0 ||
            rating > 10)
        ) {
          throw new BadRequestException(
            `Skill rating for ${name} must be a whole number from 0 to 10.`,
          );
        }

        return [name, rating];
      }),
    );

    return {
      ...input,
      name: input.name.trim(),
      contactNo: input.contactNo.trim(),
      emergencyContact: input.emergencyContact.trim(),
      gender: input.gender.trim(),
      birthday: input.birthday?.trim() ?? '',
      showAge: input.showAge === true,
      ...location,
      duprId: input.duprId?.trim() ?? '',
      reClubId: input.reClubId?.trim() ?? '',
      skills,
    };
  }

  private isValidBirthday(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day &&
      date <= new Date()
    );
  }

  private validateMemberLocation(
    locationType?: MemberLocationType,
    locationInput?: string,
  ): { locationType?: MemberLocationType; location?: string } {
    if (!locationType && !locationInput?.trim()) {
      return {};
    }

    if (locationType !== 'Sorsogon' && locationType !== 'Other') {
      throw new BadRequestException(
        'Select whether your location is Sorsogon or Other.',
      );
    }

    const location = locationInput?.trim() ?? '';
    if (!location) {
      throw new BadRequestException('Select or enter your location.');
    }

    if (
      locationType === 'Sorsogon' &&
      !SORSOGON_TOWNS.includes(location as (typeof SORSOGON_TOWNS)[number])
    ) {
      throw new BadRequestException('Select a valid Sorsogon town or city.');
    }

    return { locationType, location };
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)) as Buffer;

    return `scrypt$${salt}$${hash.toString('hex')}`;
  }

  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [algorithm, salt, expectedHashHex] = storedHash.split('$');

    if (algorithm !== 'scrypt' || !salt || !expectedHashHex) {
      return false;
    }

    const expectedHash = Buffer.from(expectedHashHex, 'hex');
    if (!expectedHash.length) {
      return false;
    }

    const actualHash = (await scrypt(
      password,
      salt,
      expectedHash.length,
    )) as Buffer;

    return timingSafeEqual(expectedHash, actualHash);
  }

  private isAzureConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 409
    );
  }

  private isAzureNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 404
    );
  }

  private createMemberAuthenticationStorageException(error: unknown) {
    this.logger.error('Member authentication storage operation failed.', error);
    return new BadGatewayException(
      'Member authentication is temporarily unavailable. Please try again.',
    );
  }

  private createMemberRegistrationStorageException(error: unknown) {
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;
    const sdkErrorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    const response =
      typeof error === 'object' && error !== null && 'response' in error
        ? error.response
        : undefined;
    const responseHeaders =
      typeof response === 'object' && response !== null && 'headers' in response
        ? response.headers
        : undefined;
    const headerErrorCode =
      typeof responseHeaders === 'object' &&
      responseHeaders !== null &&
      'get' in responseHeaders &&
      typeof responseHeaders.get === 'function'
        ? responseHeaders.get('x-ms-error-code')
        : null;
    const errorCode = headerErrorCode ?? sdkErrorCode;

    this.logger.error(
      `Member registration Table Storage request failed with status ${String(statusCode ?? 'unknown')} and code ${String(errorCode ?? 'unknown')}.`,
    );

    if (statusCode === 403) {
      return new BadGatewayException(
        'Azure Table Storage denied registration. Grant the API managed identity the Storage Table Data Contributor role on the storage account, and allow the app through the storage firewall.',
      );
    }

    if (statusCode === 404) {
      return new BadGatewayException(
        'Azure Table Storage could not find the configured Members table.',
      );
    }

    const suffix = typeof errorCode === 'string' ? ` (${errorCode})` : '';
    return new BadGatewayException(
      `Azure Table Storage could not complete registration${suffix}.`,
    );
  }

  private createRound(gameAssignments: GameAssignmentInput[]) {
    const createdAt = new Date().toISOString();
    const nextGameId =
      this.getAllGames().reduce(
        (highestId, entry) => Math.max(highestId, entry.id),
        0,
      ) + 1;

    this.validateGameAssignments(gameAssignments);

    const games = gameAssignments.map(({ courtNumber, playerIds }, index) =>
      this.createSingleGame(
        playerIds,
        courtNumber,
        createdAt,
        nextGameId + index,
      ),
    );

    const round: Round = {
      id:
        this.rounds.reduce(
          (highestId, entry) => Math.max(highestId, entry.id),
          0,
        ) + 1,
      roundNumber:
        this.rounds.reduce(
          (highestNumber, entry) => Math.max(highestNumber, entry.roundNumber),
          0,
        ) + 1,
      status: 'ongoing',
      createdAt,
      completedAt: null,
      games,
    };

    this.rounds.unshift(round);
    this.persistRounds();

    return this.toRoundView(round);
  }

  private createSingleGame(
    playerIds: number[],
    courtNumber: number,
    createdAt: string,
    gameId: number,
  ) {
    if (playerIds.length !== 4) {
      throw new BadRequestException(
        'A pickleball game requires exactly 4 players.',
      );
    }

    const uniquePlayerIds = new Set(playerIds);
    if (uniquePlayerIds.size !== 4) {
      throw new BadRequestException('Players must be unique within a game.');
    }

    const players = playerIds.map((playerId) => {
      const player = this.players.find((entry) => entry.id === playerId);

      if (!player) {
        throw new NotFoundException(`Player ${playerId} was not found.`);
      }

      return player;
    });

    const unavailablePlayer = players.find(
      (player) => !player.isReady || this.isPlayerInOngoingGame(player.id),
    );

    if (unavailablePlayer) {
      throw new BadRequestException(
        `${unavailablePlayer.name} is not eligible for a new game.`,
      );
    }

    const game: Game = {
      id: gameId,
      courtNumber,
      status: 'ongoing',
      playerIds,
      createdAt,
      completedAt: null,
      score: null,
    };

    return game;
  }

  private validateGameAssignments(gameAssignments: GameAssignmentInput[]) {
    const usedCourtNumbers = new Set<number>();

    for (const assignment of gameAssignments) {
      if (
        !Number.isInteger(assignment.courtNumber) ||
        assignment.courtNumber < 1 ||
        assignment.courtNumber > 10
      ) {
        throw new BadRequestException(
          'Court numbers must be whole numbers between 1 and 10.',
        );
      }

      if (usedCourtNumbers.has(assignment.courtNumber)) {
        throw new BadRequestException(
          'Court numbers must be unique within a batch.',
        );
      }

      usedCourtNumbers.add(assignment.courtNumber);
    }
  }

  private getMonthlyParticipationPlayers(
    month: ParticipationSourceMonth,
  ): MonthlyParticipationPlayer[] {
    const counts = new Map<string, number>();

    for (const file of month.files) {
      if (!file.name.toLowerCase().endsWith('.txt')) {
        continue;
      }

      for (const playerName of this.extractParticipantNames(file.contents)) {
        counts.set(playerName, (counts.get(playerName) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }

        return left.name.localeCompare(right.name);
      });
  }

  private parseArenaMasterEligibilityCount() {
    const rawValue = process.env.ARENA_MASTER_ELIGIBILITY_COUNT;

    if (!rawValue) {
      return null;
    }

    const parsed = Number.parseInt(rawValue, 10);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  private loadMonthsFromLocalFilesystem(): ParticipationSummarySource {
    if (!existsSync(this.openPlayParticipationRootPath)) {
      return {
        lastUpdatedAt: null,
        months: [],
      };
    }

    const months = readdirSync(this.openPlayParticipationRootPath, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const monthDirectoryPath = join(
          this.openPlayParticipationRootPath,
          entry.name,
        );
        const files = readdirSync(monthDirectoryPath)
          .map((fileName) => {
            const filePath = join(monthDirectoryPath, fileName);

            if (!statSync(filePath).isFile()) {
              return null;
            }

            return {
              name: fileName,
              contents: readFileSync(filePath, 'utf8'),
            };
          })
          .filter((file): file is ParticipationSourceFile => Boolean(file));

        return {
          name: entry.name,
          files,
        };
      });

    return {
      lastUpdatedAt: this.getLastUpdatedAtFromMonths(months),
      months,
    };
  }

  private async loadMonthsFromAzureBlobStorage(): Promise<ParticipationSummarySource> {
    if (!this.azureStorageAccount || !this.azureContainerName) {
      throw new BadRequestException(
        'OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT and OP_PARTICIPATION_AZURE_CONTAINER are required for Azure mode.',
      );
    }

    const slashPrefix = this.azurePrefix ? `${this.azurePrefix}/` : '';
    const backslashPrefix = this.azurePrefix ? `${this.azurePrefix}\\` : '';
    const blobNames = await this.listBlobNames(slashPrefix, backslashPrefix);
    const monthFiles = new Map<
      string,
      Array<{ blobName: string; fileName: string }>
    >();

    for (const blobName of blobNames) {
      if (!blobName.toLowerCase().endsWith('.txt')) {
        continue;
      }

      const relativePath = this.getRelativeBlobPath(
        blobName,
        slashPrefix,
        backslashPrefix,
      ).replace(/\\/g, '/');
      const pathSegments = relativePath
        .split('/')
        .filter((segment) => segment.length > 0);

      if (pathSegments.length < 2) {
        continue;
      }

      const monthName = pathSegments[0];
      const fileName = pathSegments.at(-1) ?? blobName;
      const filesForMonth = monthFiles.get(monthName) ?? [];

      filesForMonth.push({ blobName, fileName });
      monthFiles.set(monthName, filesForMonth);
    }

    const months = await Promise.all(
      [...monthFiles.entries()].map(async ([monthName, filesForMonth]) => ({
        name: monthName,
        files: await Promise.all(
          filesForMonth.map(async ({ blobName, fileName }) => ({
            name: fileName,
            contents: await this.fetchBlobText(blobName),
          })),
        ),
      })),
    );

    return {
      lastUpdatedAt: this.getLastUpdatedAtFromMonths(months),
      months,
    };
  }

  private getLastUpdatedAtFromMonths(
    months: ParticipationSourceMonth[],
  ): string | null {
    const latest = months.reduce<{ monthOrder: number; day: number } | null>(
      (currentLatest, month) => {
        const monthOrder = this.getMonthNameOrder(month.name);

        if (monthOrder === null) {
          return currentLatest;
        }

        const latestDay = month.files.reduce<number | null>(
          (currentDay, file) => {
            const day = this.getDayPrefix(file.name);

            if (day === null) {
              return currentDay;
            }

            return currentDay === null || day > currentDay ? day : currentDay;
          },
          null,
        );

        if (latestDay === null) {
          return currentLatest;
        }

        if (
          currentLatest === null ||
          monthOrder > currentLatest.monthOrder ||
          (monthOrder === currentLatest.monthOrder &&
            latestDay > currentLatest.day)
        ) {
          return {
            monthOrder,
            day: latestDay,
          };
        }

        return currentLatest;
      },
      null,
    );

    if (!latest) {
      return null;
    }

    const year = Number.parseInt(this.azurePrefix, 10);

    if (!Number.isInteger(year)) {
      return null;
    }

    const date = new Date(Date.UTC(year, latest.monthOrder, latest.day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== latest.monthOrder ||
      date.getUTCDate() !== latest.day
    ) {
      return null;
    }

    return date.toISOString();
  }

  private getDayPrefix(fileName: string): number | null {
    const match = fileName.match(/^(\d{1,2})(?:\D|$)/);

    if (!match) {
      return null;
    }

    const day = Number.parseInt(match[1], 10);

    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return null;
    }

    return day;
  }

  private getMonthNameOrder(monthName: string): number | null {
    const monthOrder = new Map(
      this.monthNames.map((name, index) => [name.toLowerCase(), index]),
    );

    return monthOrder.get(monthName.toLowerCase()) ?? null;
  }

  private normalizeParticipationMonth(month: string): string {
    const normalizedMonth = this.monthNames.find(
      (monthName) => monthName.toLowerCase() === month.trim().toLowerCase(),
    );

    if (!normalizedMonth) {
      throw new BadRequestException('Select a valid month for the upload.');
    }

    return normalizedMonth;
  }

  private sanitizeBlobFileName(fileName: string): string {
    const sanitizedFileName = fileName
      .replace(/[/\\]/g, '')
      .split('')
      .filter((character) => {
        const characterCode = character.charCodeAt(0);

        return characterCode >= 32 && characterCode !== 127;
      })
      .join('')
      .trim();

    if (
      !sanitizedFileName ||
      sanitizedFileName === '.' ||
      sanitizedFileName === '..'
    ) {
      throw new BadRequestException(
        'Uploaded files must have valid file names.',
      );
    }

    return sanitizedFileName;
  }

  private getRelativeBlobPath(
    blobName: string,
    slashPrefix: string,
    backslashPrefix: string,
  ): string {
    if (slashPrefix && blobName.startsWith(slashPrefix)) {
      return blobName.slice(slashPrefix.length);
    }

    if (backslashPrefix && blobName.startsWith(backslashPrefix)) {
      return blobName.slice(backslashPrefix.length);
    }

    return blobName;
  }

  private async listBlobNames(...prefixes: string[]): Promise<string[]> {
    const names: string[] = [];
    const effectivePrefixes = prefixes.length ? prefixes : [''];

    for (const prefix of effectivePrefixes) {
      let marker = '';

      do {
        const xml = await this.fetchBlobListXml(prefix, undefined, marker);
        const blobMatches = [
          ...xml.matchAll(
            /<Blob>[\s\S]*?<Name>(.*?)<\/Name>[\s\S]*?<\/Blob>/gs,
          ),
        ];

        names.push(
          ...blobMatches.map((match) => this.decodeXmlEntities(match[1] ?? '')),
        );
        marker = this.extractFirstXmlTagValue(xml, 'NextMarker');
      } while (marker);
    }

    return [...new Set(names)];
  }

  private async fetchBlobListXml(
    prefix: string,
    delimiter?: string,
    marker?: string,
  ): Promise<string> {
    const query = new URLSearchParams({
      restype: 'container',
      comp: 'list',
      prefix,
    });

    if (delimiter) {
      query.set('delimiter', delimiter);
    }

    if (marker) {
      query.set('marker', marker);
    }

    const response = await fetch(
      `${this.getAzureContainerBaseUrl()}?${query.toString()}`,
    );

    if (!response.ok) {
      throw new BadRequestException(
        `Unable to list blobs from Azure Storage container ${this.azureContainerName}.`,
      );
    }

    return response.text();
  }

  private async fetchBlobText(blobName: string): Promise<string> {
    const response = await fetch(
      `${this.getAzureContainerBaseUrl()}/${this.encodeBlobPath(blobName)}`,
    );

    if (!response.ok) {
      throw new BadRequestException(`Unable to read blob: ${blobName}`);
    }

    return response.text();
  }

  private getAzureContainerBaseUrl(): string {
    return `https://${this.azureStorageAccount}.blob.core.windows.net/${this.azureContainerName}`;
  }

  private encodeBlobPath(blobName: string): string {
    return blobName
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  private extractFirstXmlTagValue(xml: string, tagName: string): string {
    const match = xml.match(
      new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'),
    );

    if (!match?.[1]) {
      return '';
    }

    return this.decodeXmlEntities(match[1]);
  }

  private decodeXmlEntities(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  private extractParticipantNames(fileContents: string): string[] {
    const lines = fileContents.split(/\r?\n/);
    const participants = new Set<string>();
    let isInParticipantsSection = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!isInParticipantsSection) {
        if (/^Participants\s*\(\d+\)$/i.test(line)) {
          isInParticipantsSection = true;
        }

        continue;
      }

      if (/^[A-Za-z][A-Za-z0-9 '&/,-]*\(\d+\)$/i.test(line)) {
        break;
      }

      const participantMatch = line.match(/^\d+\.\s*(.+)$/);

      if (participantMatch) {
        participants.add(participantMatch[1].trim());
      }
    }

    return [...participants];
  }

  private compareMonthNames(left: string, right: string) {
    const monthOrder = new Map<string, number>([
      ['january', 0],
      ['february', 1],
      ['march', 2],
      ['april', 3],
      ['may', 4],
      ['june', 5],
      ['july', 6],
      ['august', 7],
      ['september', 8],
      ['october', 9],
      ['november', 10],
      ['december', 11],
    ]);
    const leftOrder = monthOrder.get(left.toLowerCase());
    const rightOrder = monthOrder.get(right.toLowerCase());

    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }

    if (leftOrder !== undefined) {
      return -1;
    }

    if (rightOrder !== undefined) {
      return 1;
    }

    return left.localeCompare(right);
  }

  completeGame(gameId: number, score: Partial<GameScore>) {
    const round = this.rounds.find((entry) =>
      entry.games.some((game) => game.id === gameId),
    );
    const game = round?.games.find((entry) => entry.id === gameId);

    if (!game) {
      throw new NotFoundException(`Game ${gameId} was not found.`);
    }

    if (game.status === 'completed') {
      return this.toGameView(game);
    }

    const normalizedScore = this.normalizeScore(score);

    game.status = 'completed';
    game.completedAt = new Date().toISOString();
    game.score = normalizedScore;

    if (round && round.games.every((entry) => entry.status === 'completed')) {
      round.status = 'completed';
      round.completedAt = game.completedAt;
    }

    this.persistRounds();

    return this.toRoundView(round!);
  }

  private loadRounds() {
    if (!existsSync(this.roundsFilePath)) {
      this.persistRounds([]);
      return [];
    }

    const fileContents = readFileSync(this.roundsFilePath, 'utf8');

    if (!fileContents.trim()) {
      this.persistRounds([]);
      return [];
    }

    const rounds = JSON.parse(fileContents) as Round[];
    const loadedRounds = rounds.map((round) => ({
      ...round,
      games: round.games.map((game) => ({ ...game })),
    }));
    const validRounds = this.filterRoundsWithExistingPlayers(loadedRounds);

    if (JSON.stringify(validRounds) !== JSON.stringify(loadedRounds)) {
      this.persistRounds(validRounds);
    }

    return validRounds;
  }

  private filterRoundsWithExistingPlayers(rounds: Round[]) {
    const playerIds = new Set(this.players.map((player) => player.id));

    if (!playerIds.size) {
      return [];
    }

    return rounds
      .map((round) => ({
        ...round,
        games: round.games.filter((game) =>
          game.playerIds.every((playerId) => playerIds.has(playerId)),
        ),
      }))
      .filter((round) => round.games.length > 0);
  }

  private persistRounds(rounds = this.rounds) {
    mkdirSync(dirname(this.roundsFilePath), { recursive: true });
    writeFileSync(
      this.roundsFilePath,
      `${JSON.stringify(rounds, null, 2)}\n`,
      'utf8',
    );
  }

  private buildNextGamePreview(
    players: PlayerQueueState[],
    courtCount: number,
    selectionMode: QueueSelectionMode,
    matchingMode: TeamMatchingMode,
  ) {
    const strategy = queueSelectionStrategies[selectionMode];

    if (!strategy) {
      throw new BadRequestException(
        `Unsupported queue selection mode: ${selectionMode}`,
      );
    }

    return strategy.selectNextPlayers({
      players,
      games: this.getAllGames(),
      courtCount,
      matchingMode,
    });
  }

  private toRoundView(round: Round) {
    return {
      id: round.id,
      roundNumber: round.roundNumber,
      status: round.status,
      createdAt: round.createdAt,
      completedAt: round.completedAt,
      games: round.games.map((game) => this.toGameView(game)),
    };
  }

  private toGameView(game: Game) {
    const players = game.playerIds.map((playerId) => {
      const player = this.players.find((entry) => entry.id === playerId);

      if (!player) {
        throw new NotFoundException(`Player ${playerId} was not found.`);
      }

      return player;
    });

    return {
      id: game.id,
      courtNumber: game.courtNumber,
      status: game.status,
      createdAt: game.createdAt,
      completedAt: game.completedAt,
      score: game.score,
      players,
      teams: buildTeams(players),
    };
  }

  private normalizeScore(score: Partial<GameScore>) {
    const team1 = Number(score.team1);
    const team2 = Number(score.team2);

    if (
      !Number.isInteger(team1) ||
      !Number.isInteger(team2) ||
      team1 < 0 ||
      team2 < 0
    ) {
      throw new BadRequestException(
        'Match scores must be whole numbers greater than or equal to 0.',
      );
    }

    return { team1, team2 };
  }

  private toPlayerQueueState(
    player: Player,
    recentCompletedGames: Game[],
    completedGames: Game[],
  ): PlayerQueueState {
    const lastCompletedGameAt = this.getLastCompletedGameAt(
      player.id,
      completedGames,
    );

    return {
      ...player,
      isPlaying: this.isPlayerInOngoingGame(player.id),
      recentGamesPlayed: recentCompletedGames.filter((game) =>
        game.playerIds.includes(player.id),
      ).length,
      lastCompletedGameAt,
      queueEnteredAt: this.getQueueEnteredAt(player, lastCompletedGameAt),
    };
  }

  private getLastCompletedGameAt(playerId: number, completedGames: Game[]) {
    return completedGames.reduce<string | null>((latestCompletedAt, game) => {
      if (!game.playerIds.includes(playerId) || !game.completedAt) {
        return latestCompletedAt;
      }

      if (!latestCompletedAt || game.completedAt > latestCompletedAt) {
        return game.completedAt;
      }

      return latestCompletedAt;
    }, null);
  }

  private getQueueEnteredAt(
    player: Player,
    lastCompletedGameAt: string | null,
  ) {
    if (!player.isReady) {
      return null;
    }

    if (!player.checkedInAt) {
      return lastCompletedGameAt;
    }

    if (!lastCompletedGameAt || player.checkedInAt > lastCompletedGameAt) {
      return player.checkedInAt;
    }

    return lastCompletedGameAt;
  }

  private getRecentCompletedRounds() {
    return this.rounds
      .filter((round) => round.status === 'completed')
      .sort((left, right) => (left.completedAt! < right.completedAt! ? 1 : -1))
      .slice(0, 5);
  }

  private getAllGames() {
    return this.rounds.flatMap((round) => round.games);
  }

  private isPlayerInOngoingGame(playerId: number) {
    return isPlayerInOngoingGame(this.getAllGames(), playerId);
  }
}
