"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppService = void 0;
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const players_json_1 = __importDefault(require("./data/players.json"));
const matching_selection_1 = require("./matching-selection");
const queue_selection_1 = require("./queue-selection");
const defaultRounds = [
    {
        id: 1,
        roundNumber: 1,
        status: 'ongoing',
        createdAt: '2026-05-23T08:15:00.000Z',
        completedAt: null,
        games: [
            {
                id: 1,
                courtNumber: 1,
                status: 'ongoing',
                playerIds: [1, 2, 3, 5],
                createdAt: '2026-05-23T08:15:00.000Z',
                completedAt: null,
                score: null,
            },
        ],
    },
    {
        id: 2,
        roundNumber: 2,
        status: 'completed',
        createdAt: '2026-05-23T07:40:00.000Z',
        completedAt: '2026-05-23T08:05:00.000Z',
        games: [
            {
                id: 2,
                courtNumber: 2,
                status: 'completed',
                playerIds: [4, 6, 2, 3],
                createdAt: '2026-05-23T07:40:00.000Z',
                completedAt: '2026-05-23T08:05:00.000Z',
                score: { team1: 11, team2: 8 },
            },
        ],
    },
];
let AppService = class AppService {
    openPlayParticipationRootPath = process.env.OP_PARTICIPATION_ROOT_PATH ?? (0, node_path_1.join)(process.cwd(), 'src', 'data', 'OPParticipation');
    azureStorageAccount = process.env.OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT;
    azureContainerName = process.env.OP_PARTICIPATION_AZURE_CONTAINER;
    azurePrefix = process.env.OP_PARTICIPATION_AZURE_PREFIX?.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') ?? '';
    duprMembersBlobPath = process.env.OP_PARTICIPATION_DUPR_BLOB_PATH ?? 'SPADUPR/members-list-sorsogonpickleballclub.csv';
    clubMembershipBlobPath = process.env.OP_PARTICIPATION_CLUB_MEMBERSHIP_BLOB_PATH ??
        'SPADUPR/Sorsogon Pickleball Club Member Registration (Responses) - Form Responses 1.csv';
    duprMembersLocalFilePath = process.env.DUPR_MEMBERS_LOCAL_FILE_PATH ??
        (0, node_path_1.join)(process.cwd(), 'src', 'data', 'members-list-sorsogonpickleballclub.csv');
    clubMembershipLocalFilePath = process.env.CLUB_MEMBERSHIP_LOCAL_FILE_PATH ??
        (0, node_path_1.join)(process.cwd(), 'src', 'data', 'Sorsogon Pickleball Club Member Registration (Responses) - Form Responses 1.csv');
    legacyClubMembershipLocalFilePath = (0, node_path_1.join)(process.cwd(), 'src', 'data', 'Sorsogon Pickleball Club Member Registration (Responses) - Form Responses 1.csv');
    playersFilePath = process.env.PLAYER_LIST_FILE_PATH ?? (0, node_path_1.join)(process.cwd(), 'src', 'data', 'players.json');
    players = players_json_1.default.map((player) => ({
        ...player,
    }));
    roundsFilePath = process.env.MATCH_HISTORY_FILE_PATH ?? (0, node_path_1.join)(process.cwd(), 'src', 'data', 'rounds.json');
    rounds = this.loadRounds();
    getQueueSnapshot(courtCount = 1, selectionMode = 'queue-line', matchingMode = 'dupr-balance') {
        void this.syncReferenceCsvFiles();
        const recentCompletedRounds = this.getRecentCompletedRounds();
        const recentCompletedGames = recentCompletedRounds.flatMap((round) => round.games);
        const completedGames = this.getAllGames().filter((game) => game.status === 'completed');
        const playerQueueStates = this.players.map((player) => this.toPlayerQueueState(player, recentCompletedGames, completedGames));
        const ongoingRounds = this.rounds
            .filter((round) => round.status === 'ongoing')
            .map((round) => this.toRoundView(round));
        const recentRounds = recentCompletedRounds.map((round) => this.toRoundView(round));
        return {
            players: playerQueueStates,
            ongoingRounds,
            recentRounds,
            nextGame: this.buildNextGamePreview(playerQueueStates, courtCount, selectionMode, matchingMode),
        };
    }
    updatePlayerReadyState(playerId, isReady) {
        const player = this.players.find((entry) => entry.id === playerId);
        if (!player) {
            throw new common_1.NotFoundException(`Player ${playerId} was not found.`);
        }
        player.isReady = isReady;
        player.checkedInAt = isReady ? new Date().toISOString() : null;
        return {
            ...player,
            isPlaying: this.isPlayerInOngoingGame(player.id),
        };
    }
    createGame(playerIds) {
        return this.createRound([{ courtNumber: 1, playerIds }]);
    }
    createGames(gameAssignments) {
        if (!gameAssignments.length) {
            throw new common_1.BadRequestException('At least one game is required.');
        }
        return this.createRound(gameAssignments);
    }
    async importParticipantsFromText(sourceText) {
        const referenceData = await this.loadReferenceCsvData();
        const participantNames = this.extractParticipantNames(sourceText);
        if (!participantNames.length) {
            throw new common_1.BadRequestException('No participants found. Paste text that includes a Participants (#) section.');
        }
        const membershipReclubHeader = this.findHeader(referenceData.membershipRows, ['Reclub Name']);
        const membershipSkillHeader = this.findHeader(referenceData.membershipRows, ['Skill Level (Self Assesment)', 'Skill Level (Self Assessment)', 'Skill Level']);
        const membershipDuprIdHeader = this.findHeader(referenceData.membershipRows, ['DUPR ID', 'DUPR Account ID', 'DUPR']);
        const duprIdHeader = this.findHeader(referenceData.duprRows, ['DUPR ID', 'id', 'dupr id']);
        const duprDoublesHeader = this.findHeader(referenceData.duprRows, ['doubles', 'Doubles']);
        const membershipByReclubName = new Map();
        for (const row of referenceData.membershipRows) {
            const name = membershipReclubHeader ? row[membershipReclubHeader]?.trim() : '';
            if (!name) {
                continue;
            }
            membershipByReclubName.set(this.normalizeName(name), row);
        }
        const duprById = new Map();
        for (const row of referenceData.duprRows) {
            const duprId = duprIdHeader ? row[duprIdHeader]?.trim() : '';
            if (!duprId) {
                continue;
            }
            duprById.set(duprId, row);
        }
        const importedPlayers = participantNames.map((name, index) => {
            const normalizedName = name.trim();
            const membershipRow = membershipByReclubName.get(this.normalizeName(normalizedName));
            const skillLevel = this.toSkillLevel(membershipSkillHeader && membershipRow
                ? membershipRow[membershipSkillHeader]
                : null);
            const duprId = membershipDuprIdHeader && membershipRow
                ? membershipRow[membershipDuprIdHeader]?.trim()
                : '';
            const duprRow = duprId ? duprById.get(duprId) : undefined;
            const duprRating = this.toDuprValue(duprDoublesHeader && duprRow ? duprRow[duprDoublesHeader] : null);
            return {
                id: index + 1,
                name: normalizedName,
                dupr: duprRating,
                gender: null,
                skillLevel,
                isReady: false,
                checkedInAt: null,
            };
        });
        this.players.splice(0, this.players.length, ...importedPlayers);
        this.persistPlayers();
        this.rounds.splice(0, this.rounds.length);
        this.persistRounds();
        return {
            importedPlayers: importedPlayers.length,
        };
    }
    async syncReferenceCsvFiles() {
        await Promise.all([
            this.syncCsvBlobToLocalFile(this.duprMembersBlobPath, this.duprMembersLocalFilePath),
            this.syncCsvBlobToLocalFile(this.clubMembershipBlobPath, this.clubMembershipLocalFilePath),
        ]);
    }
    async syncCsvBlobToLocalFile(blobPath, localFilePath) {
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
            (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(localFilePath), { recursive: true });
            (0, node_fs_1.writeFileSync)(localFilePath, contents, 'utf8');
        }
        catch {
        }
    }
    async loadReferenceCsvData() {
        await this.syncReferenceCsvFiles();
        const membershipCsv = this.readFirstExistingFile([
            this.clubMembershipLocalFilePath,
            this.legacyClubMembershipLocalFilePath,
        ]);
        const duprCsv = (0, node_fs_1.existsSync)(this.duprMembersLocalFilePath)
            ? (0, node_fs_1.readFileSync)(this.duprMembersLocalFilePath, 'utf8')
            : '';
        return {
            membershipRows: this.parseCsvRows(membershipCsv),
            duprRows: this.parseCsvRows(duprCsv),
        };
    }
    readFirstExistingFile(paths) {
        for (const path of paths) {
            if ((0, node_fs_1.existsSync)(path)) {
                return (0, node_fs_1.readFileSync)(path, 'utf8');
            }
        }
        return '';
    }
    parseCsvRows(contents) {
        const rows = this.parseCsv(contents).filter((row) => row.some((cell) => cell.trim().length > 0));
        if (!rows.length) {
            return [];
        }
        const headers = rows[0].map((header) => header.trim());
        return rows.slice(1).map((cells) => {
            const row = {};
            headers.forEach((header, index) => {
                if (!header) {
                    return;
                }
                row[header] = cells[index]?.trim() ?? '';
            });
            return row;
        });
    }
    parseCsv(contents) {
        const rows = [];
        let currentRow = [];
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
    findHeader(rows, candidateHeaders) {
        if (!rows.length) {
            return null;
        }
        const availableHeaders = Object.keys(rows[0]);
        const normalizedHeaders = new Map(availableHeaders.map((header) => [this.normalizeHeader(header), header]));
        for (const candidateHeader of candidateHeaders) {
            const match = normalizedHeaders.get(this.normalizeHeader(candidateHeader));
            if (match) {
                return match;
            }
        }
        return null;
    }
    normalizeHeader(value) {
        return value.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    normalizeName(name) {
        return name.trim().toLowerCase().replace(/\s+/g, ' ');
    }
    toSkillLevel(rawSkillLevel) {
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
    toDuprValue(rawDupr) {
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
    persistPlayers(players = this.players) {
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(this.playersFilePath), { recursive: true });
        (0, node_fs_1.writeFileSync)(this.playersFilePath, `${JSON.stringify(players, null, 2)}\n`, 'utf8');
    }
    async getMonthlyParticipationSummary() {
        const months = this.azureStorageAccount && this.azureContainerName
            ? await this.loadMonthsFromAzureBlobStorage()
            : this.loadMonthsFromLocalFilesystem();
        return months
            .sort((left, right) => this.compareMonthNames(left.name, right.name))
            .map((month) => ({
            month: month.name,
            players: this.getMonthlyParticipationPlayers(month),
        }));
    }
    createRound(gameAssignments) {
        const createdAt = new Date().toISOString();
        const nextGameId = this.getAllGames().reduce((highestId, entry) => Math.max(highestId, entry.id), 0) + 1;
        this.validateGameAssignments(gameAssignments);
        const games = gameAssignments.map(({ courtNumber, playerIds }, index) => this.createSingleGame(playerIds, courtNumber, createdAt, nextGameId + index));
        const round = {
            id: this.rounds.reduce((highestId, entry) => Math.max(highestId, entry.id), 0) + 1,
            roundNumber: this.rounds.reduce((highestNumber, entry) => Math.max(highestNumber, entry.roundNumber), 0) +
                1,
            status: 'ongoing',
            createdAt,
            completedAt: null,
            games,
        };
        this.rounds.unshift(round);
        this.persistRounds();
        return this.toRoundView(round);
    }
    createSingleGame(playerIds, courtNumber, createdAt, gameId) {
        if (playerIds.length !== 4) {
            throw new common_1.BadRequestException('A pickleball game requires exactly 4 players.');
        }
        const uniquePlayerIds = new Set(playerIds);
        if (uniquePlayerIds.size !== 4) {
            throw new common_1.BadRequestException('Players must be unique within a game.');
        }
        const players = playerIds.map((playerId) => {
            const player = this.players.find((entry) => entry.id === playerId);
            if (!player) {
                throw new common_1.NotFoundException(`Player ${playerId} was not found.`);
            }
            return player;
        });
        const unavailablePlayer = players.find((player) => !player.isReady || this.isPlayerInOngoingGame(player.id));
        if (unavailablePlayer) {
            throw new common_1.BadRequestException(`${unavailablePlayer.name} is not eligible for a new game.`);
        }
        const game = {
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
    validateGameAssignments(gameAssignments) {
        const usedCourtNumbers = new Set();
        for (const assignment of gameAssignments) {
            if (!Number.isInteger(assignment.courtNumber) || assignment.courtNumber < 1 || assignment.courtNumber > 10) {
                throw new common_1.BadRequestException('Court numbers must be whole numbers between 1 and 10.');
            }
            if (usedCourtNumbers.has(assignment.courtNumber)) {
                throw new common_1.BadRequestException('Court numbers must be unique within a batch.');
            }
            usedCourtNumbers.add(assignment.courtNumber);
        }
    }
    getMonthlyParticipationPlayers(month) {
        const counts = new Map();
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
    loadMonthsFromLocalFilesystem() {
        if (!(0, node_fs_1.existsSync)(this.openPlayParticipationRootPath)) {
            return [];
        }
        return (0, node_fs_1.readdirSync)(this.openPlayParticipationRootPath, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => {
            const monthDirectoryPath = (0, node_path_1.join)(this.openPlayParticipationRootPath, entry.name);
            const files = (0, node_fs_1.readdirSync)(monthDirectoryPath)
                .map((fileName) => {
                const filePath = (0, node_path_1.join)(monthDirectoryPath, fileName);
                if (!(0, node_fs_1.statSync)(filePath).isFile()) {
                    return null;
                }
                return {
                    name: fileName,
                    contents: (0, node_fs_1.readFileSync)(filePath, 'utf8'),
                };
            })
                .filter((file) => Boolean(file));
            return {
                name: entry.name,
                files,
            };
        });
    }
    async loadMonthsFromAzureBlobStorage() {
        if (!this.azureStorageAccount || !this.azureContainerName) {
            throw new common_1.BadRequestException('OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT and OP_PARTICIPATION_AZURE_CONTAINER are required for Azure mode.');
        }
        const slashPrefix = this.azurePrefix ? `${this.azurePrefix}/` : '';
        const backslashPrefix = this.azurePrefix ? `${this.azurePrefix}\\` : '';
        const blobNames = await this.listBlobNames(slashPrefix, backslashPrefix);
        const monthFiles = new Map();
        for (const blobName of blobNames) {
            if (!blobName.toLowerCase().endsWith('.txt')) {
                continue;
            }
            const relativePath = this.getRelativeBlobPath(blobName, slashPrefix, backslashPrefix)
                .replace(/\\/g, '/');
            const pathSegments = relativePath.split('/').filter((segment) => segment.length > 0);
            if (pathSegments.length < 2) {
                continue;
            }
            const monthName = pathSegments[0];
            const fileName = pathSegments.at(-1) ?? blobName;
            const filesForMonth = monthFiles.get(monthName) ?? [];
            filesForMonth.push({ blobName, fileName });
            monthFiles.set(monthName, filesForMonth);
        }
        return Promise.all([...monthFiles.entries()].map(async ([monthName, filesForMonth]) => ({
            name: monthName,
            files: await Promise.all(filesForMonth.map(async ({ blobName, fileName }) => ({
                name: fileName,
                contents: await this.fetchBlobText(blobName),
            }))),
        })));
    }
    getRelativeBlobPath(blobName, slashPrefix, backslashPrefix) {
        if (slashPrefix && blobName.startsWith(slashPrefix)) {
            return blobName.slice(slashPrefix.length);
        }
        if (backslashPrefix && blobName.startsWith(backslashPrefix)) {
            return blobName.slice(backslashPrefix.length);
        }
        return blobName;
    }
    async listBlobNames(...prefixes) {
        const names = [];
        const effectivePrefixes = prefixes.length ? prefixes : [''];
        for (const prefix of effectivePrefixes) {
            let marker = '';
            do {
                const xml = await this.fetchBlobListXml(prefix, undefined, marker);
                const blobMatches = [...xml.matchAll(/<Blob>[\s\S]*?<Name>(.*?)<\/Name>[\s\S]*?<\/Blob>/gs)];
                names.push(...blobMatches.map((match) => this.decodeXmlEntities(match[1] ?? '')));
                marker = this.extractFirstXmlTagValue(xml, 'NextMarker');
            } while (marker);
        }
        return [...new Set(names)];
    }
    async fetchBlobListXml(prefix, delimiter, marker) {
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
        const response = await fetch(`${this.getAzureContainerBaseUrl()}?${query.toString()}`);
        if (!response.ok) {
            throw new common_1.BadRequestException(`Unable to list blobs from Azure Storage container ${this.azureContainerName}.`);
        }
        return response.text();
    }
    async fetchBlobText(blobName) {
        const response = await fetch(`${this.getAzureContainerBaseUrl()}/${this.encodeBlobPath(blobName)}`);
        if (!response.ok) {
            throw new common_1.BadRequestException(`Unable to read blob: ${blobName}`);
        }
        return response.text();
    }
    getAzureContainerBaseUrl() {
        return `https://${this.azureStorageAccount}.blob.core.windows.net/${this.azureContainerName}`;
    }
    encodeBlobPath(blobName) {
        return blobName
            .split('/')
            .filter((segment) => segment.length > 0)
            .map((segment) => encodeURIComponent(segment))
            .join('/');
    }
    extractFirstXmlTagValue(xml, tagName) {
        const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
        if (!match?.[1]) {
            return '';
        }
        return this.decodeXmlEntities(match[1]);
    }
    decodeXmlEntities(value) {
        return value
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }
    extractParticipantNames(fileContents) {
        const lines = fileContents.split(/\r?\n/);
        const participants = new Set();
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
    compareMonthNames(left, right) {
        const monthOrder = new Map([
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
    completeGame(gameId, score) {
        const round = this.rounds.find((entry) => entry.games.some((game) => game.id === gameId));
        const game = round?.games.find((entry) => entry.id === gameId);
        if (!game) {
            throw new common_1.NotFoundException(`Game ${gameId} was not found.`);
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
        return this.toRoundView(round);
    }
    loadRounds() {
        if (!(0, node_fs_1.existsSync)(this.roundsFilePath)) {
            this.persistRounds(defaultRounds);
            return defaultRounds.map((round) => ({
                ...round,
                games: round.games.map((game) => ({ ...game })),
            }));
        }
        const fileContents = (0, node_fs_1.readFileSync)(this.roundsFilePath, 'utf8');
        const rounds = JSON.parse(fileContents);
        return rounds.map((round) => ({
            ...round,
            games: round.games.map((game) => ({ ...game })),
        }));
    }
    persistRounds(rounds = this.rounds) {
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(this.roundsFilePath), { recursive: true });
        (0, node_fs_1.writeFileSync)(this.roundsFilePath, `${JSON.stringify(rounds, null, 2)}\n`, 'utf8');
    }
    buildNextGamePreview(players, courtCount, selectionMode, matchingMode) {
        const strategy = queue_selection_1.queueSelectionStrategies[selectionMode];
        if (!strategy) {
            throw new common_1.BadRequestException(`Unsupported queue selection mode: ${selectionMode}`);
        }
        return strategy.selectNextPlayers({
            players,
            games: this.getAllGames(),
            courtCount,
            matchingMode,
        });
    }
    toRoundView(round) {
        return {
            id: round.id,
            roundNumber: round.roundNumber,
            status: round.status,
            createdAt: round.createdAt,
            completedAt: round.completedAt,
            games: round.games.map((game) => this.toGameView(game)),
        };
    }
    toGameView(game) {
        const players = game.playerIds.map((playerId) => {
            const player = this.players.find((entry) => entry.id === playerId);
            if (!player) {
                throw new common_1.NotFoundException(`Player ${playerId} was not found.`);
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
            teams: (0, matching_selection_1.buildTeams)(players),
        };
    }
    normalizeScore(score) {
        const team1 = Number(score.team1);
        const team2 = Number(score.team2);
        if (!Number.isInteger(team1) || !Number.isInteger(team2) || team1 < 0 || team2 < 0) {
            throw new common_1.BadRequestException('Match scores must be whole numbers greater than or equal to 0.');
        }
        return { team1, team2 };
    }
    toPlayerQueueState(player, recentCompletedGames, completedGames) {
        const lastCompletedGameAt = this.getLastCompletedGameAt(player.id, completedGames);
        return {
            ...player,
            isPlaying: this.isPlayerInOngoingGame(player.id),
            recentGamesPlayed: recentCompletedGames.filter((game) => game.playerIds.includes(player.id))
                .length,
            lastCompletedGameAt,
            queueEnteredAt: this.getQueueEnteredAt(player, lastCompletedGameAt),
        };
    }
    getLastCompletedGameAt(playerId, completedGames) {
        return completedGames.reduce((latestCompletedAt, game) => {
            if (!game.playerIds.includes(playerId) || !game.completedAt) {
                return latestCompletedAt;
            }
            if (!latestCompletedAt || game.completedAt > latestCompletedAt) {
                return game.completedAt;
            }
            return latestCompletedAt;
        }, null);
    }
    getQueueEnteredAt(player, lastCompletedGameAt) {
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
    getRecentCompletedRounds() {
        return this.rounds
            .filter((round) => round.status === 'completed')
            .sort((left, right) => (left.completedAt < right.completedAt ? 1 : -1))
            .slice(0, 5);
    }
    getAllGames() {
        return this.rounds.flatMap((round) => round.games);
    }
    isPlayerInOngoingGame(playerId) {
        return (0, queue_selection_1.isPlayerInOngoingGame)(this.getAllGames(), playerId);
    }
};
exports.AppService = AppService;
exports.AppService = AppService = __decorate([
    (0, common_1.Injectable)()
], AppService);
//# sourceMappingURL=app.service.js.map