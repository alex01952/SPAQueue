import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppService, Tournament, TournamentPrintingPlayerRef } from './app.service';

describe('Tournament printing list and per-player export tags', () => {
  const tournament: Tournament = {
    tournamentId: '123e4567-e89b-12d3-a456-426614174000', name: 'Club Open', category: 'Mixed Doubles',
    level: 'Beginner', maxSlots: 8, date: '', location: '', registrationCount: 0,
    pendingRegistrationCount: 0, registrationClosed: false, createdAt: '',
  };
  let service: AppService;
  let entities: Record<string, unknown>[];
  let session: jest.SpyInstance;
  let version: number;
  let updateEntity: jest.Mock;

  function team(id: string, status = 'Approved'): Record<string, unknown> {
    return {
      partitionKey: tournament.tournamentId, rowKey: id, TournamentId: tournament.tournamentId,
      Category: 'Mixed Doubles', Level: 'Beginner', Status: status,
      MemberId: `${id}-a`, MemberName: `${id} Alice`, MemberTshirtSize: 'XS',
      PartnerId: `${id}-b`, PartnerName: `${id} Bob`, PartnerTshirtSize: 'XXXL',
      etag: 'v1',
    };
  }

  async function refs(): Promise<TournamentPrintingPlayerRef[]> {
    return (await service.getTournamentPrintingPlayers('session', tournament.tournamentId)).players
      .filter((player) => !player.exportedForPrinting)
      .map(({ registrationId, memberId, version }) => ({ registrationId, memberId, version }));
  }

  beforeEach(() => {
    service = new AppService();
    entities = [team('one'), team('two', 'Payment Submitted'), team('three', 'Paid')];
    version = 1;
    session = jest.spyOn(service, 'getMemberSession').mockResolvedValue({
      authenticated: true, member: {
        memberId: 'admin', name: 'Admin', role: 'admin', gender: 'Male', age: 30,
        duprId: '', reClubId: '', profileImageUrl: '', skills: {}, createdAt: '', emailValidated: true,
      },
    });
    service['getTournament'] = jest.fn().mockResolvedValue(tournament);
    service['getTournamentRegistrationEntities'] = jest.fn(async () => entities.map((entity) => ({ ...entity })));
    service['getTournamentRegistrationEntity'] = jest.fn(async (_id, registrationId) => {
      const entity = entities.find((item) => item.rowKey === registrationId);
      if (!entity) throw new ConflictException('Registration removed.');
      return { ...entity };
    });
    updateEntity = jest.fn(async (updated: Record<string, unknown>, _mode: string, options: { etag: string }) => {
      const entity = entities.find((item) => item.rowKey === updated.rowKey);
      if (!entity || entity.etag !== options.etag) throw { statusCode: 412 };
      Object.assign(entity, updated, { etag: `v${++version}` });
    });
    service['getTournamentRegistrationsTableClient'] = jest.fn().mockReturnValue({ updateEntity });
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  it('lists only confirmed players, including every four-player teammate and legacy players without sizes', async () => {
    entities.push(...['Invitation Pending', 'Pending Approval', 'Invitation Declined'].map((status) => team(status, status)));
    entities.push({
      ...team('four'), Category: 'Team Tournament',
      TeamMembers: JSON.stringify([
        { memberId: 'a', name: 'A', gender: 'Male', accepted: true, tshirtSize: 'XXS' },
        { memberId: 'b', name: 'B', gender: 'Male', accepted: true, tshirtSize: 'M' },
        { memberId: 'c', name: 'C', gender: 'Female', accepted: true, tshirtSize: 'L' },
        { memberId: 'd', name: 'D', gender: 'Female', accepted: true },
      ]),
      PrintingExportedPlayers: '["a","c"]',
    });
    delete entities[0].MemberTshirtSize;
    const result = await service.getTournamentPrintingPlayers('session', tournament.tournamentId);
    expect(result.tournament).toEqual(tournament);
    expect(result.players).toHaveLength(10);
    expect(result.players.find((player) => player.memberId === 'a')).toMatchObject({
      registrationId: 'four', tshirtSize: '2XS', exportedForPrinting: true, version: 'v1',
    });
    expect(result.players.find((player) => player.memberId === 'd')).toMatchObject({ exportedForPrinting: false });
    expect(result.players.find((player) => player.memberId === 'one-a')?.tshirtSize).toBeUndefined();
    expect(result.players.map((player) => player.status)).not.toContain('Pending Approval');
    expect(JSON.stringify(result)).not.toContain('EligibilityDetails');
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it('tags the exported snapshot, skips tagged players on the next export, and untags one teammate independently', async () => {
    const exported = await refs();
    await expect(service.setTournamentPrintingTags('session', tournament.tournamentId, true, exported))
      .resolves.toEqual({ updated: true });
    expect(updateEntity).toHaveBeenCalledTimes(3);
    expect(await refs()).toEqual([]);
    const players = (await service.getTournamentPrintingPlayers('session', tournament.tournamentId)).players;
    const selected = players.find((player) => player.memberId === 'one-b')!;
    await service.setTournamentPrintingTags('session', tournament.tournamentId, false, [selected]);
    expect((await refs()).map((player) => player.memberId)).toEqual(['one-b']);
    expect(JSON.parse(String(entities[0].PrintingExportedPlayers))).toEqual(['one-a']);
    const next = await refs();
    await service.setTournamentPrintingTags('session', tournament.tournamentId, true, next);
    expect(await refs()).toEqual([]);
  });

  it('does not tag another player added after the exported snapshot', async () => {
    const snapshot = await refs();
    entities.push(team('new'));
    await service.setTournamentPrintingTags('session', tournament.tournamentId, true, snapshot);
    expect((await refs()).map((player) => player.memberId)).toEqual(['new-a', 'new-b']);
  });

  it('rejects stale versions and removed, replaced, or ineligible players before any writes', async () => {
    const snapshot = await refs();
    entities[1].etag = 'v2';
    await expect(service.setTournamentPrintingTags('session', tournament.tournamentId, true, snapshot))
      .rejects.toBeInstanceOf(ConflictException);
    expect(updateEntity).not.toHaveBeenCalled();
    entities[1].etag = 'v1';
    entities[1].Status = 'Pending Approval';
    await expect(service.setTournamentPrintingTags('session', tournament.tournamentId, true, snapshot))
      .rejects.toBeInstanceOf(ConflictException);
    entities[1].Status = 'Approved';
    entities[1].MemberId = 'replacement';
    await expect(service.setTournamentPrintingTags('session', tournament.tournamentId, true, snapshot))
      .rejects.toBeInstanceOf(ConflictException);
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it('prevents stale administrators from undoing another administrator’s tag changes', async () => {
    const [player] = await refs();
    await service.setTournamentPrintingTags('session', tournament.tournamentId, true, [player]);
    await expect(service.setTournamentPrintingTags('session', tournament.tournamentId, false, [player]))
      .rejects.toBeInstanceOf(ConflictException);
    expect(JSON.parse(String(entities[0].PrintingExportedPlayers))).toEqual(['one-a']);
  });

  it('reports a concurrent write after earlier groups have saved and allows a refreshed list to show the truth', async () => {
    const snapshot = await refs();
    updateEntity.mockImplementationOnce(async (updated: Record<string, unknown>) => {
      Object.assign(entities[0], updated, { etag: 'v2' });
    }).mockRejectedValueOnce({ statusCode: 412 });
    await expect(service.setTournamentPrintingTags('session', tournament.tournamentId, true, snapshot))
      .rejects.toThrow('Some tags may have been saved');
    expect((await refs()).map((player) => player.memberId)).toEqual(['three-a', 'three-b', 'two-a', 'two-b']);
  });

  it('propagates storage failures rather than returning success', async () => {
    updateEntity.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(service.setTournamentPrintingTags('session', tournament.tournamentId, true, await refs()))
      .rejects.toThrow();
    expect(await refs()).toHaveLength(6);
  });

  it.each([
    { exported: undefined, players: [] },
    { exported: 'true', players: [{ registrationId: 'one', memberId: 'one-a', version: 'v1' }] },
    { exported: true, players: [] },
    { exported: true, players: null },
    { exported: true, players: [null] },
    { exported: true, players: [{ registrationId: 'one', memberId: 'one-a' }] },
    { exported: true, players: [{ registrationId: 'one', memberId: 'one-a', version: '*' }] },
    { exported: true, players: Array(2).fill({ registrationId: 'one', memberId: 'one-a', version: 'v1' }) },
  ])('validates tag requests without writes: %p', async ({ exported, players }) => {
    await expect(service.setTournamentPrintingTags('session', tournament.tournamentId, exported, players))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it.each(['not JSON', '{}', '["one-a",3]'])('fails explicitly on malformed stored printing tags: %s', async (value) => {
    entities[0].PrintingExportedPlayers = value;
    await expect(service.getTournamentPrintingPlayers('session', tournament.tournamentId))
      .rejects.toBeInstanceOf(BadGatewayException);
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it('requires an administrator for both viewing and modifying printing tags', async () => {
    const players = await refs();
    const current = await service.getMemberSession('session');
    session.mockResolvedValue({ ...current, member: { ...current.member, role: 'member' } });
    await expect(service.getTournamentPrintingPlayers('session', tournament.tournamentId))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setTournamentPrintingTags('session', tournament.tournamentId, true, players))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it('blocks changes and exports when a tournament is no longer active', async () => {
    service['getTournament'] = jest.fn().mockRejectedValue(new ConflictException('Tournament is being archived.'));
    await expect(service.getTournamentPrintingPlayers('session', tournament.tournamentId)).rejects.toThrow('archived');
    await expect(service.setTournamentPrintingTags('session', tournament.tournamentId, true, [{}])).rejects.toThrow('archived');
    expect(updateEntity).not.toHaveBeenCalled();
  });
});
