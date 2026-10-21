import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppService, TournamentRoster } from './app.service';

describe('Tournament planning persistence', () => {
  const tournamentId = '123e4567-e89b-12d3-a456-426614174000';
  let service: AppService;
  let roster: TournamentRoster;
  let entity: Record<string, unknown>;
  let blobs: Map<string, Buffer>;
  let updateEntity: jest.Mock;
  let upload: jest.SpyInstance;

  beforeEach(() => {
    service = new AppService();
    roster = {
      tournamentId, tournamentName: 'Club Open', category: 'Team Tournament',
      level: 'Beginner', canManageRoster: true,
      teams: Array.from({ length: 7 }, (_, index) => ({
        registrationId: `team-${index}`, status: 'Paid', isOwnTeam: false,
        players: Array.from({ length: 4 }, (_, player) => ({
          memberId: `player-${index}-${player}`, name: `Player ${index}-${player}`,
          gender: player < 2 ? 'Male' : 'Female',
        })),
      })),
    };
    entity = { etag: 'version-1' };
    blobs = new Map();
    jest.spyOn(service, 'getMemberSession').mockResolvedValue({
      authenticated: true,
      member: {
        memberId: 'admin', name: 'Admin', role: 'admin', gender: 'Male',
        age: 30, duprId: '', reClubId: '', profileImageUrl: '', skills: {},
        createdAt: '', emailValidated: true,
      },
    });
    jest.spyOn(service, 'getTournamentRoster').mockImplementation(async () => roster);
    updateEntity = jest.fn().mockImplementation(async (update) => {
      entity = { ...entity, ...update };
    });
    jest.spyOn(service as any, 'getTournamentsTableClient').mockReturnValue({
      getEntity: jest.fn().mockImplementation(async () => entity),
      updateEntity,
    });
    jest.spyOn(service as any, 'getTournamentDocumentBlobClient').mockImplementation(
      (name: string) => ({
        name,
        downloadToBuffer: jest.fn().mockImplementation(async () => {
          const value = blobs.get(name);
          if (!value) throw new Error('Blob not found');
          return value;
        }),
      }),
    );
    upload = jest.spyOn(service as any, 'uploadParticipationBlob').mockImplementation(
      async (blob: { name: string }, contents: Buffer) => { blobs.set(blob.name, contents); },
    );
  });

  it('starts empty, saves pools, saves a schedule and restores it for another request', async () => {
    expect((await service.getTournamentPlanning('session', tournamentId)).draw).toBeNull();
    const pools = await service.updateTournamentPlanning('session', tournamentId, 'pools', 2, null);
    expect(pools.draw!.pools.map((pool) => pool.registrationIds.length)).toEqual([4, 3]);
    expect(pools.draw!.schedule).toEqual([]);
    expect(upload).toHaveBeenCalled();
    expect(updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ DrawBlobName: expect.stringContaining('tournament-draws/') }),
      'Merge', { etag: 'version-1' },
    );
    const scheduled = await service.updateTournamentPlanning(
      'session', tournamentId, 'schedule', 3, pools.version,
    );
    expect(scheduled.draw!.schedule.flatMap((slot) => slot.matches)).toHaveLength(9);
    expect(scheduled.draw!.pools).toEqual(pools.draw!.pools);
    expect(await service.getTournamentPlanning('session', tournamentId)).toEqual(scheduled);
    const redrawn = await service.updateTournamentPlanning(
      'session', tournamentId, 'pools', 3, scheduled.version,
    );
    expect(redrawn.draw!.schedule).toEqual([]);
  });

  it.each([0, -1, 1.5, '2', null])('rejects invalid counts %s', async (count) => {
    await expect(service.updateTournamentPlanning('session', tournamentId, 'pools', count, null))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects singleton pools and scheduling without a draw', async () => {
    await expect(service.updateTournamentPlanning('session', tournamentId, 'pools', 4, null))
      .rejects.toThrow('at least two teams');
    await expect(service.updateTournamentPlanning('session', tournamentId, 'schedule', 2, null))
      .rejects.toBeInstanceOf(ConflictException);
    roster.teams = roster.teams.slice(0, 1);
    await expect(service.updateTournamentPlanning('session', tournamentId, 'pools', 1, null))
      .rejects.toThrow('At least two confirmed teams');
  });

  it('hides stale pools and requires a new draw after a roster replacement or removal', async () => {
    const saved = await service.updateTournamentPlanning('session', tournamentId, 'pools', 2, null);
    roster.teams[0].players[0].memberId = 'replacement';
    const current = await service.getTournamentPlanning('session', tournamentId);
    expect(current).toMatchObject({ draw: null, rosterChanged: true, version: saved.version });
    await expect(service.updateTournamentPlanning('session', tournamentId, 'schedule', 1, saved.version))
      .rejects.toBeInstanceOf(ConflictException);
    roster.teams.pop();
    expect((await service.getTournamentPlanning('session', tournamentId)).rosterChanged).toBe(true);
    const refreshed = await service.updateTournamentPlanning('session', tournamentId, 'pools', 2, saved.version);
    expect(refreshed.rosterChanged).toBe(false);
    expect(refreshed.draw!.pools.flatMap((pool) => pool.registrationIds)).toHaveLength(6);
  });

  it('rejects stale versions and concurrent table writes', async () => {
    const saved = await service.updateTournamentPlanning('session', tournamentId, 'pools', 2, null);
    await expect(service.updateTournamentPlanning('session', tournamentId, 'schedule', 2, null))
      .rejects.toThrow('saved draw changed');
    updateEntity.mockRejectedValueOnce({ statusCode: 412 });
    await expect(service.updateTournamentPlanning('session', tournamentId, 'schedule', 2, saved.version))
      .rejects.toThrow('tournament changed');
  });

  it('requires administrator access for reading and saving', async () => {
    const session = await service.getMemberSession('session');
    jest.spyOn(service, 'getMemberSession').mockResolvedValue({
      ...session, member: { ...session.member, role: 'member' },
    });
    await expect(service.getTournamentPlanning('session', tournamentId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateTournamentPlanning('session', tournamentId, 'pools', 1, null))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(upload).not.toHaveBeenCalled();
  });
});
