import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppService } from './app.service';
import { OpenPlayService } from './open-play.service';

describe('Open Play draft storage', () => {
  const player = { id: 'player-1', name: 'Jenn', category: 'Novice', memberId: 'member-1' };
  let service: OpenPlayService;
  let role: string;
  let row: Record<string, unknown> | undefined;
  let version: number;
  const historyRows = new Map<string, Record<string, unknown>>();
  const presetRows = new Map<string, { partitionKey: string; rowKey: string; reClubName: string; category: string; gender: string }>();
  const missing = () => Object.assign(new Error('Missing entity'), { statusCode: 404, code: 'ResourceNotFound' });
  const table = {
    getEntity: jest.fn(),
    createEntity: jest.fn(),
    updateEntity: jest.fn(),
    listEntities: jest.fn(),
    upsertEntity: jest.fn(),
    deleteEntity: jest.fn(),
  };
  const historyTable = {
    createEntity: jest.fn(async (entity: Record<string, unknown>) => {
      const key = `${entity.partitionKey}|${entity.rowKey}`;
      if (historyRows.has(key)) throw Object.assign(new Error('Exists'), { statusCode: 409 });
      historyRows.set(key, { ...entity });
    }),
    getEntity: jest.fn(async (partitionKey: string, rowKey: string) => {
      const entity = historyRows.get(`${partitionKey}|${rowKey}`);
      if (!entity) throw missing();
      return { ...entity };
    }),
  };

  beforeEach(() => {
    role = 'admin';
    row = undefined;
    version = 0;
    historyRows.clear();
    presetRows.clear();
    table.listEntities.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () { yield* presetRows.values(); },
    }));
    table.upsertEntity.mockImplementation(async (entity) => { presetRows.set(entity.rowKey, entity); });
    table.deleteEntity.mockImplementation(async (_partition, id) => { if (!presetRows.delete(id)) throw missing(); });
    const app = {
      getMemberSession: jest.fn(async () => ({ member: { memberId: 'admin-1', role } })),
      getOpenPlayBoardMembers: jest.fn(async () => ({})),
      getOpenPlayGoldMembershipExpiries: jest.fn(async (_token: string, ids: string[]) => Object.fromEntries(ids.map((id) => [id, null]))),
    } as unknown as AppService;
    service = new OpenPlayService(app);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    Object.defineProperty(service, 'getTable', { value: () => table });
    Object.defineProperty(service, 'getHistoryTable', { value: () => historyTable });
    table.getEntity.mockImplementation(async () => { if (!row) throw missing(); return { ...row }; });
    table.createEntity.mockImplementation(async (entity: Record<string, unknown>) => {
      if (row) throw Object.assign(new Error('Exists'), { statusCode: 409 });
      row = { ...entity, etag: String(++version) };
    });
    table.updateEntity.mockImplementation(async (entity: Record<string, unknown>, _mode: string, options: { etag: string }) => {
      if (row?.etag !== options.etag) throw Object.assign(new Error('Conflict'), { statusCode: 412 });
      row = { ...(_mode === 'Merge' ? row : {}), ...entity, etag: String(++version) };
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('lets admins and balance staff share one persistent preset per normalized Reclub name', async () => {
    const saved = await service.saveImportPreset('admin-session', { reClubName: '  Ｐlayer   One ', category: 'Novice', gender: 'Female' });
    expect(saved).toMatchObject({ reClubName: 'Player One', category: 'Novice', gender: 'Female' });
    role = 'balance-staff';
    expect(await service.getImportPresets('staff-session')).toEqual([saved]);
    const edited = await service.saveImportPreset('staff-session', { reClubName: 'player one', category: 'Intermediate', gender: 'Male' });
    expect(edited.id).toBe(saved.id);
    expect(await service.getImportPresets('staff-session')).toEqual([edited]);
    await service.deleteImportPreset('staff-session', saved.id);
    expect(await service.getImportPresets('staff-session')).toEqual([]);
    expect(table.upsertEntity).toHaveBeenCalledWith(expect.objectContaining({ partitionKey: 'import-presets', rowKey: saved.id }), 'Replace');
    expect(table.listEntities).toHaveBeenCalledWith(expect.objectContaining({ queryOptions: expect.objectContaining({ filter: "PartitionKey eq 'import-presets'" }) }));
    expect(table.deleteEntity).toHaveBeenCalledWith('import-presets', saved.id);
  });

  it('rejects unauthorized preset access and invalid data before touching storage', async () => {
    const input = { reClubName: 'Guest', category: 'Novice', gender: 'Female' };
    role = 'member';
    await expect(service.getImportPresets('session')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.saveImportPreset('session', input)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteImportPreset('session', 'a'.repeat(64))).rejects.toBeInstanceOf(ForbiddenException);
    role = 'admin';
    for (const invalid of [{ reClubName: '  ' }, { category: 'Expert' }, { gender: '' }]) {
      await expect(service.saveImportPreset('session', { ...input, ...invalid })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(service.deleteImportPreset('session', 'invalid')).rejects.toBeInstanceOf(BadRequestException);
    expect(table.listEntities).not.toHaveBeenCalled();
    expect(table.upsertEntity).not.toHaveBeenCalled();
    expect(table.deleteEntity).not.toHaveBeenCalled();
  });

  it('reports an invalid stored preset without a row key', async () => {
    table.listEntities.mockImplementationOnce(() => ({
      [Symbol.asyncIterator]: async function* () {
        yield { reClubName: 'Player', category: 'Novice', gender: 'Female' };
      },
    }));
    await expect(service.getImportPresets('session')).rejects.toBeInstanceOf(BadGatewayException);
    expect(service['logger'].error).toHaveBeenCalled();
  });

  it('creates and reloads a draft, preserving linked member IDs', async () => {
    expect(await service.getDraft('session')).toEqual({ players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], playerLocks: [], matchingMode: 'wait-priority', forcedCategory: null, secondaryEnabled: false, secondaryForcedCategory: null, nextPlayerIds: null, secondaryNextPlayerIds: null, tieBreakSeed: 0, liveBoardState: null, session: null, benchMigrationNeeded: false, revision: null, courtNameVersion: 1, queueVersion: 4 });
    const saved = await service.saveDraft('session', { players: [player], revision: null });
    expect(saved.matchingMode).toBe('wait-priority');
    expect(row?.MatchingMode).toBe('wait-priority');
    expect(await service.getDraft('session')).toEqual(saved);
    expect(row).toMatchObject({ partitionKey: 'drafts', rowKey: 'current', UpdatedBy: 'admin-1' });
    expect(await service.saveDraft('session', { players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], revision: saved.revision })).toMatchObject({ players: [] });
  });

  it('rejects stale drafts and duplicate players', async () => {
    const saved = await service.saveDraft('session', { players: [player], revision: null });
    await expect(service.saveDraft('session', { players: [player], revision: null })).rejects.toBeInstanceOf(ConflictException);
    await service.saveDraft('session', { players: [player], courts: [], matches: [], queue: ['player-1'], winnersQueue: [], bench: saved.bench, unavailable: [], revision: saved.revision });
    await expect(service.saveDraft('session', { players: [], matches: [], revision: saved.revision })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.saveDraft('session', { players: [player, { ...player, id: 'player-2' }], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves optional roster genders through saves and reloads and rejects invalid values', async () => {
    const players = [
      { ...player, id: 'legacy', memberId: null },
      { ...player, id: 'blank', memberId: null, gender: '' },
      { ...player, id: 'woman', memberId: null, gender: 'Female' },
      { ...player, id: 'man', memberId: null, gender: 'Male' },
    ];
    const saved = await service.saveDraft('session', { players, revision: null });
    expect(saved.players.map((entry) => entry.gender)).toEqual([undefined, '', 'Female', 'Male']);
    expect((await service.getDraft('session')).players).toEqual(saved.players);
    const updated = await service.saveDraft('session', { ...saved, players: saved.players.map((entry) => ({ ...entry, gender: '' })) });
    expect((await service.getDraft('session')).players.every((entry) => entry.gender === '')).toBe(true);
    await expect(service.saveDraft('session', { ...updated, players: [{ ...players[0], gender: 'invalid' }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists disjoint player lock groups and rejects invalid or omitted locks', async () => {
    const players = Array.from({ length: 5 }, (_, index) => ({ ...player, id: `player-${index}`, memberId: null }));
    const playerLocks = [['player-0', 'player-1'], ['player-2', 'player-3', 'player-4']];
    const saved = await service.saveDraft('session', { players, playerLocks, revision: null });
    expect(saved.playerLocks).toEqual(playerLocks);
    expect(JSON.parse(String(row?.PlayerLocks))).toEqual(playerLocks);
    expect((await service.getDraft('session')).playerLocks).toEqual(playerLocks);
    await expect(service.saveDraft('session', { players, playerLocks: [['player-0']], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players, playerLocks: [['player-0', 'player-0']], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players, playerLocks: [['player-0', 'player-1'], ['player-1', 'player-2']], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players, revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('includes locked player names on the active board even while they are playing', async () => {
    const players = Array.from({ length: 4 }, (_, index) => ({
      ...player, id: `locked-${index}`, name: `Player ${index}`, memberId: null, status: 'Active',
    }));
    const saved = await service.saveDraft('session', { players, playerLocks: [[players[0].id, players[1].id]], revision: null });
    expect((await service.getBoard('session')).lockGroups).toEqual([]);
    const started = await service.startSession('session', { revision: saved.revision });
    const match = {
      id: 'ongoing', teams: [players.slice(0, 2), players.slice(2, 4)], status: 'ongoing', winner: null, score: null,
      startedAt: '2026-11-08T10:00:00Z', completedAt: null, court: null,
    };
    await service.saveDraft('session', {
      ...started, matches: [match],
      bench: Object.fromEntries(players.map((entry) => [entry.id, { accumulatedMs: 0, since: null }])),
    });
    const board = await service.getBoard('session');
    expect(board.regularLine).toEqual([]);
    expect(board.lockGroups).toEqual([[{ id: 'locked-0', name: 'Player 0' }, { id: 'locked-1', name: 'Player 1' }]]);
  });

  it('keeps published player locks through reloads and match saves until explicitly unlocked', async () => {
    const players = Array.from({ length: 4 }, (_, index) => ({
      ...player, id: `locked-${index}`, memberId: null, status: 'Active',
    }));
    const saved = await service.saveDraft('session', { players, revision: null });
    const playerLocks = [[players[0].id, players[1].id]];
    const settings = { matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null, unavailable: [], revision: saved.revision };
    await service.publishBoardState('session', { ...settings, playerLocks });
    const reloaded = await service.getDraft('session');
    expect(reloaded.playerLocks).toEqual(playerLocks);

    const match = {
      id: 'locked-match', teams: [players.slice(0, 2), players.slice(2, 4)], status: 'ongoing', winner: null, score: null,
      startedAt: '2026-11-08T10:00:00Z', completedAt: null, court: null,
    };
    const ongoing = await service.saveDraft('session', {
      ...reloaded, matches: [match],
      bench: Object.fromEntries(players.map((entry) => [entry.id, { accumulatedMs: 0, since: null }])),
    });
    expect((await service.getDraft('session')).playerLocks).toEqual(playerLocks);
    const completed = await service.saveDraft('session', {
      ...ongoing, matches: [{ ...match, status: 'completed', winner: 1, completedAt: '2026-11-08T10:15:00Z' }],
      bench: Object.fromEntries(players.map((entry) => [entry.id, { accumulatedMs: 0, since: '2026-11-08T10:15:00Z' }])),
    });
    expect((await service.getDraft('session')).playerLocks).toEqual(playerLocks);
    expect((await service.getBoard('session')).playerLocks).toEqual(playerLocks);

    await service.publishBoardState('session', { ...settings, revision: completed.revision, playerLocks: [] });
    expect((await service.getDraft('session')).playerLocks).toEqual([]);
    expect((await service.getBoard('session')).playerLocks).toEqual([]);
  });

  it('preserves a published lineup through reloads, session start, and roster saves', async () => {
    const players = Array.from({ length: 8 }, (_, index) => ({ ...player, id: `lineup-${index}`, memberId: null, status: 'Active' }));
    const nextPlayerIds = players.slice(0, 4).map((entry) => entry.id);
    const secondaryNextPlayerIds = players.slice(4).map((entry) => entry.id);
    const saved = await service.saveDraft('session', { players, revision: null });
    await service.publishBoardState('session', {
      matchingMode: 'wait-priority', forcedCategory: null, playerLocks: [], unavailable: [], nextPlayerIds, revision: saved.revision,
    });
    expect(JSON.parse(String(row!.NextPlayerIds))).toEqual(nextPlayerIds);
    row!.NextPlayerIds = 'null';
    expect(await service.getDraft('session')).toMatchObject({ nextPlayerIds });
    const started = await service.startSession('session', { revision: saved.revision });
    expect(started).toMatchObject({ nextPlayerIds, secondaryNextPlayerIds: null });
    const settings = { matchingMode: 'wait-priority', forcedCategory: null, secondaryEnabled: true, secondaryForcedCategory: null, playerLocks: [], unavailable: [], revision: started.revision };
    expect(await service.getBoard('session')).toMatchObject({ nextPlayerIds, secondaryNextPlayerIds: null });
    const { nextPlayerIds: _lineup, ...olderPayload } = started;
    const preserved = await service.saveDraft('session', { ...olderPayload, queue: players.slice().reverse().map((entry) => entry.id) });
    expect(await service.getBoard('session')).toMatchObject({ nextPlayerIds });
    expect(preserved.nextPlayerIds).toEqual(nextPlayerIds);
    settings.revision = preserved.revision;
    await service.publishBoardState('session', { ...settings, nextPlayerIds, secondaryNextPlayerIds: null });
    expect(await service.getBoard('session')).toMatchObject({ nextPlayerIds, secondaryNextPlayerIds: null });
    await service.publishBoardState('session', { ...settings, nextPlayerIds: secondaryNextPlayerIds });
    expect(await service.getBoard('session')).toMatchObject({ nextPlayerIds: secondaryNextPlayerIds });
    expect(await service.getDraft('session')).toMatchObject({ nextPlayerIds: secondaryNextPlayerIds });
  });

  it('shares and preserves randomized tie-break seeds between draft and board', async () => {
    const saved = await service.saveDraft('session', { players: [player], revision: null });
    expect(saved.tieBreakSeed).toBe(0);
    await service.publishBoardState('session', {
      matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null, playerLocks: [], unavailable: [],
      tieBreakSeed: 123456, revision: saved.revision,
    });
    expect((await service.getBoard('session')).tieBreakSeed).toBe(123456);
    const draft = await service.getDraft('session');
    expect(draft.tieBreakSeed).toBe(123456);
    const { tieBreakSeed: _seed, ...olderPayload } = draft;
    expect((await service.saveDraft('session', olderPayload)).tieBreakSeed).toBe(123456);
    await expect(service.saveDraft('session', { ...draft, tieBreakSeed: -1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saves and publishes two disjoint waiting groups and preserves them at session start', async () => {
    const players = Array.from({ length: 8 }, (_, index) => ({ ...player, id: `waiting-${index}`, memberId: null, status: 'Active' }));
    const nextPlayerIds = players.slice(0, 4).map((entry) => entry.id);
    const followingPlayerIds = players.slice(4).map((entry) => entry.id);
    const saved = await service.saveDraft('session', { players, nextPlayerIds, followingPlayerIds, revision: null });
    expect(await service.getDraft('session')).toMatchObject({ nextPlayerIds, followingPlayerIds });
    const started = await service.startSession('session', { revision: saved.revision });
    expect(started).toMatchObject({ nextPlayerIds, followingPlayerIds });
    const settings = { matchingMode: 'wait-priority', forcedCategory: null, playerLocks: [], unavailable: [], revision: started.revision };
    await service.publishBoardState('session', { ...settings, nextPlayerIds: followingPlayerIds, followingPlayerIds: nextPlayerIds });
    expect(await service.getBoard('session')).toMatchObject({ nextPlayerIds: followingPlayerIds, followingPlayerIds: nextPlayerIds });
    expect(await service.getDraft('session')).toMatchObject({ nextPlayerIds: followingPlayerIds, followingPlayerIds: nextPlayerIds });
    await expect(service.publishBoardState('session', { ...settings, nextPlayerIds, followingPlayerIds: nextPlayerIds })).rejects.toThrow('same player');
    await expect(service.saveDraft('session', { ...started, nextPlayerIds, followingPlayerIds: nextPlayerIds })).rejects.toThrow('same player');
    await expect(service.publishBoardState('session', { ...settings, nextPlayerIds, followingPlayerIds: [players[4].id] })).rejects.toBeInstanceOf(BadRequestException);
    const { followingPlayerIds: _following, ...olderPayload } = await service.getDraft('session');
    const preserved = await service.saveDraft('session', olderPayload);
    expect(preserved).toMatchObject({ nextPlayerIds: followingPlayerIds, followingPlayerIds: nextPlayerIds });
  });

  it('ignores legacy secondary settings when loading, publishing, and saving', async () => {
    const saved = await service.saveDraft('session', { players: [player], revision: null });
    expect(saved).toMatchObject({ secondaryEnabled: false, secondaryForcedCategory: null });
    const settings = { matchingMode: saved.matchingMode, forcedCategory: null, nextPlayerIds: null, playerLocks: [], unavailable: [], revision: saved.revision };
    row!.SecondaryEnabled = true;
    row!.SecondaryForcedCategory = 'High Intermediate';
    row!.SecondaryNextPlayerIds = 'invalid legacy lineup';
    expect(await service.getDraft('session')).toMatchObject({ secondaryEnabled: false, secondaryForcedCategory: null, secondaryNextPlayerIds: null });
    await service.publishBoardState('session', { ...settings, secondaryEnabled: true, secondaryForcedCategory: 'High Intermediate' });
    const reloaded = await service.getDraft('session');
    expect(reloaded).toMatchObject({ secondaryEnabled: false, secondaryForcedCategory: null });
    expect(await service.getBoard('session')).toMatchObject({ secondaryEnabled: false, secondaryForcedCategory: null });
    const { secondaryEnabled: _enabled, secondaryForcedCategory: _category, ...olderPayload } = reloaded;
    const preserved = await service.saveDraft('session', olderPayload);
    expect(preserved).toMatchObject({ secondaryEnabled: false, secondaryForcedCategory: null });
    await service.publishBoardState('session', { ...settings, revision: preserved.revision, secondaryEnabled: false, secondaryForcedCategory: null });
    expect(await service.getDraft('session')).toMatchObject({ secondaryEnabled: false, secondaryForcedCategory: null });
    expect(await service.getBoard('session')).toMatchObject({ secondaryEnabled: false, secondaryForcedCategory: null });
  });

  it('persists and validates the forced category', async () => {
    const saved = await service.saveDraft('session', { players: [player], forcedCategory: 'High Intermediate', revision: null });
    expect(saved.forcedCategory).toBe('High Intermediate');
    expect(row?.ForcedCategory).toBe('High Intermediate');
    expect((await service.getDraft('session')).forcedCategory).toBe('High Intermediate');
    await expect(service.saveDraft('session', { players: [player], forcedCategory: 'Expert', revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    const { forcedCategory: _forcedCategory, ...olderPayload } = saved;
    expect((await service.saveDraft('session', { ...olderPayload, revision: saved.revision })).forcedCategory).toBe('High Intermediate');
  });

  it('returns Reclub names on the member board without changing the saved roster or membership frames', async () => {
    const players = [
      { ...player, id: 'board-0', name: 'Gold Full Name', memberId: 'member-gold', status: 'Active' },
      { ...player, id: 'board-1', name: 'Regular Full Name', memberId: 'member-plain', status: 'Active' },
      { ...player, id: 'board-2', name: 'Legacy Full Name', memberId: 'member-legacy', status: 'Active' },
      { ...player, id: 'board-3', name: 'Guest Name', memberId: null, status: 'Active' },
    ];
    const accountService = service['app'] as unknown as AppService;
    jest.spyOn(accountService, 'getOpenPlayBoardMembers').mockResolvedValue({
      'member-gold': { reClubId: 'Z Gold', goldMembershipExpiresOn: '2999-01-01' },
      'member-plain': { reClubId: 'A Regular', goldMembershipExpiresOn: null },
      'member-legacy': { reClubId: '', goldMembershipExpiresOn: null },
    });
    const nextPlayerIds = players.map((entry) => entry.id);
    const playerLocks = [['board-0', 'board-1']];
    const saved = await service.saveDraft('session', { players, nextPlayerIds, playerLocks, revision: null });
    expect(saved.nextPlayerIds).toEqual(nextPlayerIds);
    expect(JSON.parse(String(row?.NextPlayerIds))).toEqual(nextPlayerIds);
    const started = await service.startSession('session', { revision: saved.revision });
    expect(started.session?.active).toBe(true);
    const match = {
      id: 'completed-board-match', teams: [players.slice(0, 2), players.slice(2)], status: 'completed', winner: 1, score: null,
      startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z', court: null,
    };
    const updated = await service.saveDraft('session', { ...started, matches: [match, { ...match, id: 'completed-board-2' }, { ...match, id: 'completed-board-3' }], queue: ['board-0', 'board-2', 'board-3'], winnersQueue: ['board-1'] });
    expect(updated.players.map((entry) => entry.name)).toEqual(players.map((entry) => entry.name));
    role = 'member';
    const board = await service.getBoard('member-session');
    expect(board.active).toBe(true);
    expect(board.regularLine).toMatchObject([
      { id: 'board-0', name: 'Z Gold', membershipType: 'gold-member' },
      { id: 'board-2', name: 'Legacy Full Name', membershipType: 'member' },
      { id: 'board-3', name: 'Guest Name', membershipType: 'non-member' },
    ]);
    expect(board.winnersLine).toMatchObject([{ id: 'board-1', name: 'A Regular', membershipType: 'member' }]);
    expect(board.topFive.map((entry) => entry.name)).toEqual(['Z Gold', 'A Regular', 'Guest Name', 'Legacy Full Name']);
    expect(board.lockGroups).toEqual([[{ id: 'board-0', name: 'Z Gold' }, { id: 'board-1', name: 'A Regular' }]]);
    expect(board.nextPlayerIds).toEqual(nextPlayerIds);
    expect(board).not.toHaveProperty('matches');
    expect(board.regularLine[0]).not.toHaveProperty('memberId');
    role = 'admin';
    await service.publishBoardState('session', { matchingMode: 'wait-priority', forcedCategory: 'High Intermediate', nextPlayerIds: null, playerLocks: [], unavailable: [], revision: updated.revision });
    expect((await service.getBoard('member-session')).forcedCategory).toBe('High Intermediate');
    await service.publishBoardState('session', { matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null, playerLocks: [], unavailable: [], revision: updated.revision });
    expect((await service.getBoard('member-session')).forcedCategory).toBeNull();
    await expect(service.saveDraft('session', { players, nextPlayerIds: [players[0].id, players[0].id, '', ''], revision: updated.revision })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exposes only occupied court names and saved start times while the session is active', async () => {
    const saved = await service.saveDraft('session', { players: [], revision: null });
    const match = {
      id: 'private-match', teams: [[{ id: 'private-player', name: 'Private Player', memberId: 'private-member' }]],
      status: 'ongoing' as const, winner: null, score: null,
      startedAt: '2026-11-12T10:00:00Z', completedAt: null,
      court: { number: 2, name: 'Arena South', category: 'Novice' as const },
    };
    const session = { id: 'session', active: true, startedAt: match.startedAt, endedAt: null, awardReview: null };
    const draft = { ...saved, session, matches: [
      match,
      { ...match, id: 'north-match', court: { ...match.court, number: 1, name: 'Arena North' } },
      { ...match, id: 'completed-match', status: 'completed' as const, court: { ...match.court, number: 3 } },
      { ...match, id: 'unassigned-match', court: null },
    ] };
    const getDraft = jest.spyOn(service, 'getDraft').mockResolvedValue(draft);
    expect((await service.getBoard('session')).activeCourts).toEqual([
      { number: 1, name: 'Arena North', startedAt: match.startedAt },
      { number: 2, name: 'Arena South', startedAt: match.startedAt },
    ]);
    getDraft.mockResolvedValue({ ...draft, session: { ...session, active: false } });
    expect((await service.getBoard('session')).activeCourts).toEqual([]);
    getDraft.mockRestore();
  });

  it('uses the three-decided-match minimum for the board, Gold awards, and archive', async () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      ...player, id: `threshold-${index}`, name: `Player ${index}`, memberId: index === 0 || index === 4 ? `gold-${index}` : null, status: 'Active',
    }));
    jest.spyOn(service['app'] as unknown as AppService, 'getOpenPlayGoldMembershipExpiries').mockResolvedValue({ 'gold-0': '2999-01-01', 'gold-4': '2999-01-01' });
    const saved = await service.saveDraft('session', { players, revision: null });
    const started = await service.startSession('session', { revision: saved.revision });
    const match = {
      id: 'qualifying-1', teams: [players.slice(0, 2), players.slice(2, 4)], status: 'completed', winner: 1, score: null,
      startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z', court: null,
    };
    const matches = [
      match, { ...match, id: 'qualifying-2' }, { ...match, id: 'qualifying-3' },
      { ...match, id: 'short-1', teams: [players.slice(4, 6), players.slice(0, 2)] },
      { ...match, id: 'short-2', teams: [players.slice(4, 6), players.slice(0, 2)] },
      { ...match, id: 'undecided', teams: [players.slice(4, 6), players.slice(0, 2)], winner: null },
    ];
    const updated = await service.saveDraft('session', { ...started, matches });
    const board = await service.getBoard('session');
    expect(board.topFive.map((entry) => entry.id)).toEqual(['threshold-0', 'threshold-1', 'threshold-2', 'threshold-3']);
    expect(board.regularLine.find((entry) => entry.id === 'threshold-4')).toMatchObject({ games: 2, wins: 2 });
    const ended = await service.endSession('session', { revision: updated.revision });
    const candidates = ended.session!.awardReview!.candidates;
    expect(candidates.find((entry) => entry.memberId === 'gold-0')).toMatchObject({ topFiveRank: 1, topFiveRequestId: expect.any(String) });
    expect(candidates.find((entry) => entry.memberId === 'gold-4')).toMatchObject({ topFiveRank: null, topFiveRequestId: null, participated: true });
    const skipped = await service.saveAwardDecision('session', { sessionId: ended.session!.id, selectedAwardIds: [], skip: true });
    await service.archiveSession('session', { sessionId: skipped.session!.id, revision: skipped.revision });
    const history = historyRows.get(`sessions|${skipped.session!.id}`)!;
    expect(JSON.parse(String(history.TopFive)).map((entry: { name: string }) => entry.name))
      .toEqual(['Player 0', 'Player 1', 'Player 2', 'Player 3']);
  });

  it('starts one session and builds a persisted Gold participation and Top 5 review', async () => {
    const players = Array.from({ length: 4 }, (_, index) => ({
      ...player, id: `session-${index}`, name: `Player ${index}`, memberId: index < 3 ? `gold-${index}` : null, status: 'Active',
    }));
    const accountService = service['app'] as unknown as AppService;
    jest.spyOn(accountService, 'getOpenPlayGoldMembershipExpiries').mockResolvedValue({ 'gold-0': '2027-01-01', 'gold-1': '2027-01-01', 'gold-2': '2025-01-01' });
    const saved = await service.saveDraft('session', { players, revision: null });
    const started = await service.startSession('session', { revision: saved.revision });
    expect(started.session?.active).toBe(true);
    await expect(service.startSession('session', { revision: started.revision })).rejects.toBeInstanceOf(ConflictException);

    const match = {
      id: 'session-match', teams: [players.slice(0, 2), players.slice(2, 4)], status: 'completed', winner: 1, score: null,
      startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z', court: null,
    };
    const afterMatch = await service.saveDraft('session', { ...started, matches: [match, { ...match, id: 'session-match-2' }, { ...match, id: 'session-match-3' }], revision: started.revision });
    const ended = await service.endSession('session', { revision: afterMatch.revision });
    expect(ended.session?.active).toBe(false);
    expect(ended.session?.awardReview?.candidates.map((entry) => entry.memberId)).toEqual(['gold-0', 'gold-1']);
    const review = ended.session!.awardReview!;
    const participation = `${review.candidates[0].memberId}:participation`;
    const bonus = `${review.candidates[0].memberId}:top-five`;
    const reviewed = await service.saveAwardDecision('session', { sessionId: ended.session!.id, selectedAwardIds: [participation, bonus], skip: false });
    expect(reviewed.session?.awardReview?.selectedAwardIds).toEqual([participation, bonus]);
    const partial = await service.recordAwardProgress('session', { sessionId: ended.session!.id, awardId: participation });
    expect(partial.session?.awardReview?.awardedAwardIds).toEqual([participation]);
    await expect(service.saveAwardDecision('session', { sessionId: ended.session!.id, selectedAwardIds: [bonus], skip: false })).rejects.toBeInstanceOf(BadRequestException);
    await service.recordAwardProgress('session', { sessionId: ended.session!.id, awardId: bonus });
    const completed = await service.completeAwardReview('session', { sessionId: ended.session!.id });
    expect(completed.session?.awardReview).toMatchObject({ completed: true, awardedAwardIds: [participation, bonus] });
  });

  it('includes checked-in Gold members who are still waiting without completed matches', async () => {
    const players = Array.from({ length: 3 }, (_, index) => ({
      ...player, id: `waiting-${index}`, name: `Waiting ${index}`, memberId: `gold-waiting-${index}`, status: index === 2 ? 'Not Arrived' : 'Active',
    }));
    jest.spyOn(service['app'] as unknown as AppService, 'getOpenPlayGoldMembershipExpiries').mockResolvedValue(
      Object.fromEntries(players.map((entry) => [entry.memberId!, '2027-01-01'])),
    );
    const saved = await service.saveDraft('session', { players, revision: null });
    const started = await service.startSession('session', { revision: saved.revision });
    const ended = await service.endSession('session', { revision: started.revision });
    expect(ended.session?.awardReview?.candidates.map((entry) => entry.memberId)).toEqual(players.map((entry) => entry.memberId));
    expect(ended.session?.awardReview?.candidates.map((entry) => entry.participated)).toEqual([true, true, false]);
    expect(ended.session?.awardReview?.selectedAwardIds).toEqual(['gold-waiting-0:participation', 'gold-waiting-1:participation']);
  });

  it('can skip all session awards and then start the next session', async () => {
    const saved = await service.saveDraft('session', { players: [], revision: null });
    const started = await service.startSession('session', { revision: saved.revision });
    const ended = await service.endSession('session', { revision: started.revision });
    const skipped = await service.saveAwardDecision('session', { sessionId: ended.session!.id, selectedAwardIds: [], skip: true });
    expect(skipped.session?.awardReview).toMatchObject({ skipped: true, completed: true, selectedAwardIds: [] });
    const next = await service.startSession('session', { revision: skipped.revision });
    expect(next.session?.active).toBe(true);
    expect(next.session?.awardReview).toBeNull();
  });

  it('archives matches and Top 5 once, then clears the live roster and session', async () => {
    const players = Array.from({ length: 4 }, (_, index) => ({
      ...player, id: `archive-${index}`, name: `Player ${index}`, memberId: index < 2 ? `gold-${index}` : null, status: 'Active',
    }));
    jest.spyOn(service['app'] as unknown as AppService, 'getOpenPlayGoldMembershipExpiries').mockResolvedValue({ 'gold-0': '2027-01-01', 'gold-1': '2027-01-01' });
    const saved = await service.saveDraft('session', { players, courts: [{ number: 1, name: 'Court 1', category: 'Novice' }], revision: null });
    const started = await service.startSession('session', { revision: saved.revision });
    const match = {
      id: 'archive-match', teams: [players.slice(0, 2).map(({ id, name, memberId }) => ({ id, name, memberId })), players.slice(2).map(({ id, name, memberId }) => ({ id, name, memberId }))],
      status: 'completed', winner: 1, score: { team1: 11, team2: 3 }, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z', court: null,
    };
    const afterMatch = await service.saveDraft('session', { ...started, matches: [match, { ...match, id: 'archive-match-2' }, { ...match, id: 'archive-match-3' }], revision: started.revision });
    const ended = await service.endSession('session', { revision: afterMatch.revision });
    const skipped = await service.saveAwardDecision('session', { sessionId: ended.session!.id, selectedAwardIds: [], skip: true });

    const archived = await service.archiveSession('session', { sessionId: skipped.session!.id, revision: skipped.revision });
    const history = historyRows.get(`sessions|${skipped.session!.id}`)!;
    expect(history.SessionId).toBe(skipped.session!.id);
    expect(JSON.parse(String(history.MatchPart0))).toHaveLength(3);
    expect(JSON.parse(String(history.TopFive)).map((entry: { name: string }) => entry.name)).toEqual(expect.arrayContaining(['Player 0', 'Player 1']));
    expect(archived).toMatchObject({ players: [], matches: [], queue: [], winnersQueue: [], session: null, courts: [{ number: 1, name: 'Court 1', category: 'Novice' }] });
    expect(await service.archiveSession('session', { sessionId: skipped.session!.id, revision: skipped.revision })).toEqual(archived);
    expect(historyRows.size).toBe(1);
  });

  it('rejects non-admin access and reports missing tables as failures', async () => {
    role = 'member';
    await expect(service.getDraft('session')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.saveDraft('session', { players: [], revision: null })).rejects.toBeInstanceOf(ForbiddenException);
    role = 'admin';
    table.getEntity.mockRejectedValueOnce(Object.assign(new Error('Missing table'), { statusCode: 404, code: 'TableNotFound' }));
    await expect(service.getDraft('session')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('allows balance staff to manage Open Play', async () => {
    role = 'balance-staff';
    const saved = await service.saveDraft('session', { players: [], revision: null });
    expect(saved.players).toEqual([]);
    expect(await service.getDraft('session')).toMatchObject({ players: [], session: null });
  });

  it('reports an ETag race as a conflict', async () => {
    const saved = await service.saveDraft('session', { players: [player], revision: null });
    table.updateEntity.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { statusCode: 412 }));
    await expect(service.saveDraft('session', { players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], revision: saved.revision })).rejects.toBeInstanceOf(ConflictException);
    expect(await service.getDraft('session')).toEqual(saved);
  });

  it('loads legacy rosters with active players and no matches', async () => {
    row = { Players: JSON.stringify([player]), Revision: 'legacy', etag: '1' };
    expect(await service.getDraft('session')).toMatchObject({ players: [{ ...player, status: 'Active' }], courts: [], matches: [], queue: ['player-1'], winnersQueue: [], bench: { 'player-1': { accumulatedMs: 0, since: expect.any(String) } }, unavailable: [], benchMigrationNeeded: true, revision: 'legacy', courtNameVersion: 1, queueVersion: 4 });
  });

  it('persists match results without scores and retains snapshots after a player is removed', async () => {
    const match = {
      id: 'match-1', teams: [[player, { ...player, id: 'player-2', memberId: null }],
        [{ ...player, id: 'player-3', memberId: null }, { ...player, id: 'player-4', memberId: null }]],
      status: 'completed', winner: 1, score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z',
    };
    const saved = await service.saveDraft('session', { players: [], matches: [match], revision: null });
    expect((await service.getDraft('session')).matches[0]).toMatchObject({ winner: 1, score: null, teams: [[{ id: 'player-1', memberId: 'member-1' }, { id: 'player-2' }], [{ id: 'player-3' }, { id: 'player-4' }]] });
    await expect(service.saveDraft('session', { players: [], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players: [], matches: [{ ...match, score: { team1: 2, team2: 11 } }], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists completed matches without a winner or score', async () => {
    const match = {
      id: 'match-no-result', teams: [[player, { ...player, id: 'player-2', memberId: null }],
        [{ ...player, id: 'player-3', memberId: null }, { ...player, id: 'player-4', memberId: null }]],
      status: 'completed', winner: null, score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z',
    };
    await service.saveDraft('session', { players: [], matches: [match], revision: null });
    expect((await service.getDraft('session')).matches[0]).toMatchObject({ status: 'completed', winner: null, score: null });
  });

  it('stores long match histories in parts without splitting Unicode characters', async () => {
    const participant = { id: 'one', name: '🎾'.repeat(90), memberId: null };
    const matches = Array.from({ length: 60 }, (_, index) => ({
      id: `match-${index}`, teams: [[participant, { ...participant, id: 'two' }], [{ ...participant, id: 'three' }, { ...participant, id: 'four' }]],
      status: 'completed', winner: 1, score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z',
    }));
    const saved = await service.saveDraft('session', { players: [], matches, revision: null });
    expect(row?.MatchPartCount).toBeGreaterThan(1);
    expect(await service.getDraft('session')).toEqual(saved);
  });

  it('rejects invalid availability and players in two ongoing matches', async () => {
    await expect(service.saveDraft('session', { players: [{ ...player, status: 'Unknown' }], matches: [], revision: null })).rejects.toBeInstanceOf(BadRequestException);
    const ongoing = {
      id: 'one', teams: [[player, { ...player, id: 'player-2', memberId: null }],
        [{ ...player, id: 'player-3', memberId: null }, { ...player, id: 'player-4', memberId: null }]],
      status: 'ongoing', winner: null, score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: null,
    };
    await expect(service.saveDraft('session', { players: [], matches: [ongoing, { ...ongoing, id: 'two' }], revision: null })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists court categories and prevents occupied courts from being changed or double-booked', async () => {
    const court = { number: 1, category: 'Novice' };
    const ongoing = {
      id: 'one', teams: [[player, { ...player, id: 'player-2', memberId: null }],
        [{ ...player, id: 'player-3', memberId: null }, { ...player, id: 'player-4', memberId: null }]],
      status: 'ongoing', winner: null, score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: null, court,
    };
    const saved = await service.saveDraft('session', { players: [], courts: [court, { number: 2, category: 'Intermediate' }], matches: [ongoing], revision: null });
    expect(await service.getDraft('session')).toEqual(saved);
    await expect(service.saveDraft('session', { players: [], courts: [], matches: [ongoing], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players: [], courts: [{ ...court, category: 'Intermediate' }], matches: [ongoing], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    const otherMatch = { ...ongoing, id: 'two', teams: ongoing.teams.map((team) => team.map((entry) => ({ ...entry, id: `${entry.id}-other`, memberId: null }))) };
    await expect(service.saveDraft('session', { players: [], courts: [court], matches: [ongoing, otherMatch], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players: [], matches: [ongoing], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves court names and uses numbered names for legacy courts and matches', async () => {
    const ongoing = {
      id: 'legacy-match', teams: [[player, { ...player, id: 'player-2', memberId: null }],
        [{ ...player, id: 'player-3', memberId: null }, { ...player, id: 'player-4', memberId: null }]],
      status: 'ongoing', winner: null, score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: null,
      court: { number: 1, category: 'Novice' },
    };
    row = { Players: '[]', Courts: JSON.stringify([{ number: 1, category: 'Novice' }]), Matches: JSON.stringify([ongoing]), Revision: 'legacy', etag: '1' };
    const legacy = await service.getDraft('session');
    expect(legacy.courts[0].name).toBe('Court 1');
    expect(legacy.matches[0].court?.name).toBe('Court 1');
    row = undefined;
    const named = { number: 2, name: '  Arena South  ', category: 'Intermediate' };
    const saved = await service.saveDraft('session', { players: [], courts: [named], matches: [], revision: null });
    expect(saved.courts[0].name).toBe('Arena South');
    expect((await service.getDraft('session')).courts[0].name).toBe('Arena South');
    await expect(service.saveDraft('session', { players: [], courts: [{ ...named, name: '  ' }], matches: [], revision: null })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores the court name with a match even after the court is removed', async () => {
    const court = { number: 2, name: 'North Arena', category: 'Intermediate' };
    const match = {
      id: 'named-match', teams: [[player, { ...player, id: 'player-2', memberId: null }],
        [{ ...player, id: 'player-3', memberId: null }, { ...player, id: 'player-4', memberId: null }]],
      status: 'completed', winner: 1, score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z', court,
    };
    await service.saveDraft('session', { players: [], courts: [], matches: [match], revision: null });
    expect((await service.getDraft('session')).matches[0].court).toEqual(court);
  });

  it('keeps old matches unassigned and rejects invalid or duplicate court numbers', async () => {
    const ongoing = {
      id: 'legacy-match', teams: [[player, { ...player, id: 'player-2', memberId: null }],
        [{ ...player, id: 'player-3', memberId: null }, { ...player, id: 'player-4', memberId: null }]],
      status: 'ongoing', winner: null, score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: null,
    };
    row = { Players: '[]', Matches: JSON.stringify([ongoing]), Revision: 'legacy', etag: '1' };
    const draft = await service.getDraft('session');
    expect(draft.courts).toEqual([]);
    expect(draft.matches[0].court).toBeNull();
    await expect(service.saveDraft('session', { players: [], courts: [{ number: 1, category: 'Novice' }, { number: 1, category: 'Intermediate' }], matches: [], revision: null })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players: [], courts: [{ number: 0, category: 'Novice' }], matches: [], revision: null })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists line order and rejects missing, duplicate, or inactive players', async () => {
    const players = [
      { ...player, status: 'Active' },
      { ...player, id: 'player-2', memberId: null, status: 'Active' },
      { ...player, id: 'player-3', memberId: null, status: 'Not Arrived' },
    ];
    const saved = await service.saveDraft('session', { players, courts: [], matches: [], queue: ['player-2'], winnersQueue: ['player-1'], revision: null });
    expect((await service.getDraft('session'))).toMatchObject({ queue: ['player-2'], winnersQueue: ['player-1'] });
    for (const queue of [['player-1'], ['player-1', 'player-1'], ['player-1', 'player-3']]) {
      await expect(service.saveDraft('session', { players, courts: [], matches: [], queue, winnersQueue: [], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(service.saveDraft('session', { players, courts: [], matches: [], queue: ['player-1'], winnersQueue: ['player-1'], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players, courts: [], matches: [], queue: ['player-2', 'player-1'], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players, courts: [], matches: [], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('migrates the existing normal line without reordering it', async () => {
    const players = [player, { ...player, id: 'player-2', memberId: null }];
    row = { Players: JSON.stringify(players), Queue: JSON.stringify(['player-2', 'player-1']), Revision: 'legacy', etag: '1' };
    expect(await service.getDraft('session')).toMatchObject({ queue: ['player-2', 'player-1'], winnersQueue: [], unavailable: [], queueVersion: 4 });
  });

  it('persists bench clocks and rejects clocks running while resting or playing', async () => {
    const active = { ...player, status: 'Active' };
    const resting = { ...player, id: 'resting', memberId: null, status: 'Rest' };
    const bench = { 'player-1': { accumulatedMs: 60000, since: '2026-11-08T10:00:00Z' }, resting: { accumulatedMs: 120000, since: null } };
    const saved = await service.saveDraft('session', { players: [active, resting], queue: ['player-1'], winnersQueue: [], courts: [], matches: [], bench, revision: null });
    expect((await service.getDraft('session')).bench).toEqual(bench);
    await expect(service.saveDraft('session', { players: [active, resting], queue: ['player-1'], winnersQueue: [], courts: [], matches: [], bench: { ...bench, resting: { accumulatedMs: 0, since: '2026-11-08T10:00:00Z' } }, revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players: [active, resting], queue: ['player-1'], winnersQueue: [], courts: [], matches: [], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('initializes legacy bench clocks for active waiting players and persists migration', async () => {
    const revision = '00000000-0000-4000-8000-000000000001';
    row = { Players: JSON.stringify([{ ...player, status: 'Active' }]), Queue: JSON.stringify(['player-1']), Courts: '[]', Revision: revision, etag: '1' };
    const draft = await service.getDraft('session');
    expect(draft.benchMigrationNeeded).toBe(true);
    expect(draft.bench['player-1']).toMatchObject({ accumulatedMs: 0, since: expect.any(String) });
    const saved = await service.saveDraft('session', { ...draft, revision });
    expect(saved.benchMigrationNeeded).toBe(false);
    expect((await service.getDraft('session')).bench).toEqual(draft.bench);
  });

  it('initializes and validates in-play bench clocks as paused', async () => {
    const players = Array.from({ length: 4 }, (_, index) => ({
      ...player, id: `player-${index}`, memberId: null, status: 'Active',
    }));
    const match = {
      id: 'ongoing', teams: [players.slice(0, 2), players.slice(2, 4)], status: 'ongoing', winner: null, score: null,
      startedAt: '2026-11-08T10:00:00Z', completedAt: null, court: null,
    };
    row = { Players: JSON.stringify(players), Matches: JSON.stringify([match]), Revision: 'legacy', etag: '1' };
    const draft = await service.getDraft('session');
    expect(Object.values(draft.bench).every((clock) => clock.since === null)).toBe(true);
    const invalid = { ...draft.bench, 'player-0': { accumulatedMs: 0, since: '2026-11-08T10:00:00Z' } };
    await expect(service.saveDraft('session', { ...draft, bench: invalid, revision: null })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists unavailable active players and protects the flag from older clients', async () => {
    const active = { ...player, status: 'Active' };
    const bench = { 'player-1': { accumulatedMs: 0, since: '2026-11-08T10:00:00Z' } };
    const saved = await service.saveDraft('session', { players: [active], courts: [], matches: [], queue: ['player-1'], winnersQueue: [], bench, unavailable: ['player-1'], revision: null });
    expect((await service.getDraft('session')).unavailable).toEqual(['player-1']);
    await expect(service.saveDraft('session', { players: [active], courts: [], matches: [], queue: ['player-1'], winnersQueue: [], bench, revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveDraft('session', { players: [{ ...active, status: 'Rest' }], courts: [], matches: [], queue: [], winnersQueue: [], bench: { 'player-1': { accumulatedMs: 0, since: null } }, unavailable: ['player-1'], revision: saved.revision })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unavailable players who are currently playing', async () => {
    const players = Array.from({ length: 4 }, (_, index) => ({ ...player, id: `player-${index}`, memberId: null, status: 'Active' }));
    const match = { id: 'ongoing', teams: [players.slice(0, 2), players.slice(2, 4)], status: 'ongoing', winner: null, score: null,
      startedAt: '2026-11-08T10:00:00Z', completedAt: null, court: null };
    await expect(service.saveDraft('session', { players, courts: [], matches: [match], queue: players.map((entry) => entry.id), winnersQueue: [], unavailable: ['player-0'], revision: null })).rejects.toBeInstanceOf(BadRequestException);
  });
});