import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { buildTeams } from './matching-selection';
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

@Injectable()
export class AppService {
  private readonly openPlayParticipationRootPath =
    process.env.OP_PARTICIPATION_ROOT_PATH ??
    join(process.cwd(), 'src', 'data', 'OPParticipation');
  private readonly azureStorageAccount =
    process.env.OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT;
  private readonly azureContainerName =
    process.env.OP_PARTICIPATION_AZURE_CONTAINER;
  private readonly azurePrefix =
    process.env.OP_PARTICIPATION_AZURE_PREFIX?.replace(/\\/g, '/').replace(
      /^\/+|\/+$/g,
      '',
    ) ?? '';
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

    return monthOrder.get(monthName.toLowerCase()) ?? null;
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
