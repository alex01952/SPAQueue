import { BadGatewayException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppService } from './app.service';

describe('Tournament archive and deletion', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  type Entity = Record<string, unknown> & { partitionKey: string; rowKey: string };
  const key = (partition: string, row: string) => `${partition}/${row}`;
  function table() {
    const rows = new Map<string, Entity>();
    const client = {
      getEntity: jest.fn(async (partition: string, row: string) => {
        const entity = rows.get(key(partition, row));
        if (!entity) throw { statusCode: 404 };
        return { ...entity };
      }),
      upsertEntity: jest.fn(async (entity: Entity) => { rows.set(key(entity.partitionKey, entity.rowKey), { ...entity, etag: 'v1' }); }),
      updateEntity: jest.fn(async (entity: Entity) => {
        const stored = rows.get(key(entity.partitionKey, entity.rowKey));
        if (!stored) throw { statusCode: 404 };
        rows.set(key(entity.partitionKey, entity.rowKey), { ...stored, ...entity, etag: 'v2' });
      }),
      deleteEntity: jest.fn(async (partition: string, row: string) => {
        if (!rows.delete(key(partition, row))) throw { statusCode: 404 };
      }),
      listEntities: jest.fn(({ queryOptions }: { queryOptions?: { filter: string } } = {}) => {
        const partition = queryOptions?.filter.match(/PartitionKey eq '([^']+)'/)?.[1];
        return (async function* () {
          for (const entity of rows.values()) if (!partition || entity.partitionKey === partition) yield { ...entity };
        })();
      }),
    };
    return { rows, client };
  }
  let service: AppService;
  let active: ReturnType<typeof table>;
  let archive: ReturnType<typeof table>;
  let registrations: ReturnType<typeof table>;
  let protests: ReturnType<typeof table>;
  let blobs: Set<string>;
  let deleteBlob: jest.Mock;
  let session: jest.SpyInstance;

  beforeEach(() => {
    service = new AppService();
    active = table(); archive = table(); registrations = table(); protests = table();
    active.rows.set(key('tournaments', id), {
      partitionKey: 'tournaments', rowKey: id, Name: 'Club Open', Category: 'Mens Doubles',
      Level: 'Beginner', MaxSlots: 8, CreatedAt: '2026-10-01', etag: 'v1',
      TermsBlobName: `tournament-terms/${id}/terms.pdf`,
    });
    registrations.rows.set(key(id, 'team-1'), {
      partitionKey: id, rowKey: 'team-1', TournamentId: id, TournamentName: 'Club Open',
      Category: 'Mens Doubles', Level: 'Beginner', Status: 'Paid', MemberId: 'a', MemberName: 'Alice',
      PartnerId: 'b', PartnerName: 'Bob', RegisteredAt: '2026-10-01',
      PaymentProofs: JSON.stringify([{
        memberId: 'a', memberName: 'Alice', fileName: 'proof.pdf', uploadedAt: '2026-10-01',
        blobName: `tournament-payment-proofs/${id}/team-1/proof.pdf`, contentType: 'application/pdf',
      }]),
    });
    protests.rows.set(key(id, 'protest-1'), {
      partitionKey: id, rowKey: 'protest-1', TournamentName: 'Club Open', Status: 'Open',
      ProtesterId: 'a', ProtestedMemberId: 'c', EligibilityCategory: 'Skill level eligibility',
      Reason: 'Detailed reason for eligibility protest',
      EvidenceFiles: JSON.stringify([{
        blobName: `tournament-protest-evidence/${id}/protest-1/evidence.pdf`,
        fileName: 'evidence.pdf', contentType: 'application/pdf', size: 10, uploadedAt: '2026-10-01',
      }]),
    });
    session = jest.spyOn(service, 'getMemberSession').mockResolvedValue({
      authenticated: true, member: {
        memberId: 'admin', name: 'Administrator', role: 'admin', gender: 'Male', age: 30,
        duprId: '', reClubId: '', profileImageUrl: '', skills: {}, createdAt: '', emailValidated: true,
      },
    });
    jest.spyOn(service as any, 'getTournamentsTableClient').mockReturnValue(active.client);
    jest.spyOn(service as any, 'getTournamentArchiveTableClient').mockReturnValue(archive.client);
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(registrations.client);
    jest.spyOn(service as any, 'getTournamentProtestsTableClient').mockReturnValue(protests.client);
    blobs = new Set([
      `tournament-terms/${id}/terms.pdf`, `tournament-payment-proofs/${id}/team-1/proof.pdf`,
      `tournament-payment-proofs/${id}/deleted-team/old.pdf`, `tournament-protest-evidence/${id}/protest-1/evidence.pdf`,
      `tournament-draws/${id}/old.json`, 'tournament-draws/other-event/keep.json',
      `tournament-live-draws/${id}/event.json`, 'tournament-live-draws/other-event/keep.json',
    ]);
    deleteBlob = jest.fn(async (name: string) => { blobs.delete(name); return { succeeded: true }; });
    jest.spyOn(service as any, 'getTournamentDocumentContainerClient').mockReturnValue({
      listBlobsFlat: ({ prefix }: { prefix: string }) => (async function* () {
        for (const name of [...blobs]) if (name.startsWith(prefix)) yield { name };
      })(),
      getBlockBlobClient: (name: string) => ({ deleteIfExists: () => deleteBlob(name) }),
    });
    jest.spyOn(service as any, 'getTournamentDocumentBlobClient').mockReturnValue({
      downloadToBuffer: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')),
    });
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  it('moves every table record and retains files, then exposes read-only archived data and private URLs', async () => {
    const before = new Set(blobs);
    await expect(service.archiveTournament('session', id)).resolves.toEqual({ archived: true });
    expect(active.rows.size).toBe(0);
    expect(registrations.rows.size).toBe(0);
    expect(protests.rows.size).toBe(0);
    expect(archive.rows.size).toBe(3);
    expect(blobs).toEqual(before);
    expect((await service.getTournaments('session'))).toEqual([]);
    expect(await service.getTournamentRegistrationsForAdmin('session')).toEqual([]);
    expect(await service.getTournamentProtestsForAdmin('session')).toEqual([]);
    expect(await service.getArchivedTournaments('session')).toHaveLength(1);
    const details = await service.getTournamentArchiveDetails('session', id);
    expect(details.tournament).toMatchObject({ name: 'Club Open', archivedBy: 'Administrator', registrationCount: 1 });
    expect(details.roster.canManageRoster).toBe(false);
    expect(details.registrations[0].paymentProofs![0].url).toContain(`/admin/tournament-archive/${id}/registrations/`);
    expect(details.protests[0].evidence[0].url).toContain(`/admin/tournament-archive/${id}/protests/`);
    await expect(service.getTournamentTerms('session', id, true)).resolves.toEqual(Buffer.from('%PDF-1.7'));
    await expect(service.getTournamentPaymentProof('session', id, 'team-1', 'a', true)).resolves.toMatchObject({ contentType: 'application/pdf' });
    await expect(service.getTournamentProtestEvidence('session', id, 'protest-1', 0, true)).resolves.toMatchObject({ fileName: 'evidence.pdf' });
    await expect(service.markTournamentRegistrationPaid('session', id, 'team-1')).rejects.toThrow('Tournament was not found');
    await expect(service.cancelTournamentRegistration('session', id, 'team-1')).rejects.toThrow('Tournament was not found');
  });

  it('copies all partitions before deleting source records and can retry copy failures', async () => {
    const upsert = archive.client.upsertEntity.getMockImplementation()!;
    archive.client.upsertEntity.mockImplementationOnce(upsert).mockImplementationOnce(upsert)
      .mockRejectedValueOnce(new Error('storage down'));
    await expect(service.archiveTournament('session', id)).rejects.toBeInstanceOf(BadGatewayException);
    expect(registrations.rows.size).toBe(1);
    expect(protests.rows.size).toBe(1);
    expect(active.rows.get(key('tournaments', id))!.LifecycleState).toBe('Archiving');
    await expect(service.deleteTournament('session', id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.markTournamentRegistrationPaid('session', id, 'team-1')).rejects.toBeInstanceOf(ConflictException);
    await service.archiveTournament('session', id);
    expect(await service.getArchivedTournaments('session')).toHaveLength(1);
  });

  it('retains the saved pools and schedule without changing their version', async () => {
    const draw = {
      version: 'saved-version', rosterSignature: 'signature',
      pools: [{ number: 1, registrationIds: ['team-1', 'team-2'] }],
      courtCount: 1, schedule: [{ number: 1, matches: [{
        courtNumber: 1, poolNumber: 1, teamOneId: 'team-1', teamTwoId: 'team-2',
      }] }], updatedAt: '2026-10-20', updatedBy: 'admin',
    };
    active.rows.get(key('tournaments', id))!.DrawBlobName = `tournament-draws/${id}/saved-version.json`;
    jest.spyOn(service as any, 'getTournamentDocumentBlobClient').mockReturnValue({
      downloadToBuffer: jest.fn().mockResolvedValue(Buffer.from(JSON.stringify(draw))),
    });
    await service.archiveTournament('session', id);
    expect((await service.getTournamentArchiveDetails('session', id)).draw).toEqual(draw);
  });

  it('blocks deletion through the archive endpoint while the source move is incomplete', async () => {
    protests.client.deleteEntity.mockRejectedValueOnce(new Error('outage'));
    await expect(service.archiveTournament('session', id)).rejects.toBeInstanceOf(BadGatewayException);
    await expect(service.deleteTournament('session', id, true)).rejects.toBeInstanceOf(ConflictException);
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it('deletes snapshots on the base blob and explicitly removes retained blob versions', async () => {
    const baseDelete = jest.fn().mockResolvedValue({ succeeded: true });
    const versionDelete = jest.fn().mockResolvedValue({ succeeded: true });
    const withVersion = jest.fn().mockReturnValue({ deleteIfExists: versionDelete });
    jest.spyOn(service as any, 'getTournamentDocumentContainerClient').mockReturnValue({
      listBlobsFlat: ({ prefix }: { prefix: string }) => (async function* () {
        if (prefix.startsWith('tournament-terms/')) {
          yield { name: `${prefix}terms.pdf`, versionId: 'old-version' };
          yield { name: `${prefix}terms.pdf`, versionId: 'new-version' };
        }
      })(),
      getBlockBlobClient: () => ({ deleteIfExists: baseDelete, withVersion }),
    });
    await service.deleteTournament('session', id);
    expect(baseDelete).toHaveBeenCalledTimes(1);
    expect(baseDelete).toHaveBeenCalledWith({ deleteSnapshots: 'include' });
    expect(withVersion.mock.calls).toEqual([['old-version'], ['new-version']]);
    expect(versionDelete).toHaveBeenCalledTimes(2);
  });

  it('retains already-copied records when retrying a partially completed source cleanup', async () => {
    protests.client.deleteEntity.mockRejectedValueOnce(new Error('temporary outage'));
    await expect(service.archiveTournament('session', id)).rejects.toBeInstanceOf(BadGatewayException);
    expect(registrations.rows.size).toBe(0);
    expect(archive.rows.size).toBe(3);
    expect(await service.getArchivedTournaments('session')).toEqual([]);
    await service.archiveTournament('session', id);
    expect((await service.getTournamentArchiveDetails('session', id)).registrations).toHaveLength(1);
    expect(active.rows.size).toBe(0);
  });

  it('permanently deletes active data, orphaned/old files, and no other tournament files', async () => {
    await expect(service.deleteTournament('session', id)).resolves.toEqual({ deleted: true });
    expect(active.rows.size + registrations.rows.size + protests.rows.size + archive.rows.size).toBe(0);
    expect(blobs).toEqual(new Set(['tournament-draws/other-event/keep.json', 'tournament-live-draws/other-event/keep.json']));
  });

  it('permanently deletes an archived tournament and its retained files', async () => {
    await service.archiveTournament('session', id);
    await expect(service.deleteTournament('session', id, true)).resolves.toEqual({ deleted: true });
    expect(archive.rows.size).toBe(0);
    expect(blobs).toEqual(new Set(['tournament-draws/other-event/keep.json', 'tournament-live-draws/other-event/keep.json']));
  });

  it('keeps a retryable parent when blob deletion fails instead of reporting success', async () => {
    deleteBlob.mockRejectedValueOnce(new Error('blob outage'));
    await expect(service.deleteTournament('session', id)).rejects.toBeInstanceOf(BadGatewayException);
    expect(active.rows.size).toBe(1);
    expect(registrations.rows.size).toBe(1);
    await service.deleteTournament('session', id);
    expect(active.rows.size).toBe(0);
  });

  it('rejects malformed identifiers before any lifecycle writes', async () => {
    await expect(service.archiveTournament('session', "bad'id")).rejects.toThrow('Invalid tournament identifier');
    await expect(service.deleteTournament('session', 'bad')).rejects.toThrow('Invalid tournament identifier');
    expect(active.client.updateEntity).not.toHaveBeenCalled();
  });

  it('requires admin access for lifecycle operations, archive records and retained documents', async () => {
    const current = await service.getMemberSession('session');
    session.mockResolvedValue({ ...current, member: { ...current.member, role: 'member' } });
    for (const operation of [
      () => service.archiveTournament('session', id),
      () => service.deleteTournament('session', id),
      () => service.deleteTournament('session', id, true),
      () => service.getArchivedTournaments('session'),
      () => service.getTournamentArchiveDetails('session', id),
      () => service.getTournamentTerms('session', id, true),
      () => service.getTournamentPaymentProof('session', id, 'team-1', 'a', true),
      () => service.getTournamentProtestEvidence('session', id, 'protest-1', 0, true),
    ]) await expect(operation()).rejects.toBeInstanceOf(ForbiddenException);
    expect(active.client.updateEntity).not.toHaveBeenCalled();
  });
});
