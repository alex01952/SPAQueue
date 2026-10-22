import { Readable } from 'node:stream';
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppService, TournamentRoster } from './app.service';
import type { LiveDrawEvent } from './tournament-live-draw';

describe('Persistent live tournament draw', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const base = Date.parse('2026-10-23T10:00:00Z');
  const start = base + 120_000;
  let now: number;
  let service: AppService;
  let roster: TournamentRoster;
  let entity: Record<string, unknown>;
  let closed: boolean;
  let blobs: Map<string, { contents: Buffer; etag: string }>;
  let serial: number;
  let upload: jest.Mock;
  let update: jest.Mock;
  let getSession: jest.SpyInstance;

  beforeEach(() => {
    now = base; serial = 0; closed = true;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    service = new AppService();
    roster = {
      tournamentId: id, tournamentName: 'Club Open', category: 'Mixed Doubles', level: 'Beginner', canManageRoster: true,
      teams: ['a', 'b', 'c', 'd'].map((player) => ({
        registrationId: `team-${player}`, status: 'Paid', isOwnTeam: false,
        players: [{ memberId: player, name: player, gender: 'Male' }],
      })),
    };
    entity = { etag: 't1' };
    blobs = new Map();
    getSession = jest.spyOn(service, 'getMemberSession').mockImplementation(async (token) => ({
      authenticated: true,
      member: {
        memberId: token, name: token, role: token === 'admin' ? 'admin' : 'member',
        gender: 'Male', age: 30, duprId: '', reClubId: '', profileImageUrl: '', skills: {},
        createdAt: '', emailValidated: true,
      },
    }));
    jest.spyOn(service as any, 'getTournament').mockImplementation(async () => {
      if (entity.LifecycleState) throw new ConflictException('Tournament is being archived.');
      return { registrationClosed: closed };
    });
    jest.spyOn(service as any, 'getTournamentRosterForMember').mockImplementation(async () => structuredClone(roster));
    update = jest.fn(async (value, _mode, options) => {
      if (options.etag !== entity.etag) throw { statusCode: 412 };
      entity = { ...entity, ...value, etag: `t${++serial}` };
    });
    jest.spyOn(service as any, 'getTournamentsTableClient').mockReturnValue({
      getEntity: jest.fn(async () => ({ ...entity })), updateEntity: update,
    });
    upload = jest.fn(async (name: string, contents: Buffer, options: { conditions: { ifMatch?: string; ifNoneMatch?: string } }) => {
      const existing = blobs.get(name);
      if (options.conditions.ifMatch && options.conditions.ifMatch !== existing?.etag) throw { statusCode: 412 };
      if (options.conditions.ifNoneMatch && existing) throw { statusCode: 412 };
      blobs.set(name, { contents: Buffer.from(contents), etag: `b${++serial}` });
    });
    jest.spyOn(service as any, 'getTournamentDocumentBlobClient').mockImplementation((name: string) => ({
      name,
      upload: (contents: Buffer, _size: number, options: { conditions: { ifMatch?: string; ifNoneMatch?: string } }) => upload(name, contents, options),
      download: async () => {
        const stored = blobs.get(name);
        if (!stored) throw new Error('missing blob');
        return { etag: stored.etag, readableStreamBody: Readable.from([Buffer.from(stored.contents)]) };
      },
      downloadToBuffer: async () => blobs.get(name)!.contents,
    }));
    jest.spyOn(service as any, 'uploadParticipationBlob').mockImplementation(async (blob: { name: string }, contents: Buffer) => {
      blobs.set(blob.name, { contents: Buffer.from(contents), etag: `b${++serial}` });
    });
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  async function schedule() {
    return service.scheduleTournamentLiveDraw('admin', id, {
      scheduledAt: new Date(start).toISOString(), poolCount: 2, rosterFinalized: true, expectedEventId: null,
    });
  }
  async function attend(ids = ['a', 'b', 'c']) {
    now = start - 5000;
    for (const player of ids) await service.getTournamentLiveDraw(player, id, 'presence');
  }
  function storedEvent(): LiveDrawEvent {
    return JSON.parse(blobs.get(String(entity.LiveDrawBlobName))!.contents.toString());
  }

  it('requires a closed, finalized roster, admin role, future date and valid pool count', async () => {
    const input = { scheduledAt: new Date(start).toISOString(), poolCount: 2, rosterFinalized: true, expectedEventId: null };
    await expect(service.scheduleTournamentLiveDraw('a', id, input)).rejects.toBeInstanceOf(ForbiddenException);
    closed = false;
    await expect(schedule()).rejects.toBeInstanceOf(ConflictException);
    closed = true;
    for (const invalid of [
      { ...input, rosterFinalized: false }, { ...input, scheduledAt: new Date(base).toISOString() },
      { ...input, poolCount: 3 }, { ...input, poolCount: 0 }, { ...input, poolCount: 1.5 },
    ]) await expect(service.scheduleTournamentLiveDraw('admin', id, invalid)).rejects.toBeInstanceOf(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it('starts empty, schedules persistent state and prevents stale admin overwrites', async () => {
    expect((await service.getTournamentLiveDraw('a', id)).event).toBeNull();
    const state = await schedule();
    expect(state.event?.phase).toBe('scheduled');
    expect(state.event?.pools).toBeNull();
    expect(entity.DrawBlobName).toBe('');
    expect(storedEvent().eventId).toBe(state.event!.eventId);
    await expect(schedule()).rejects.toBeInstanceOf(ConflictException);
  });

  it('authenticates and loads the tournament only once per presence refresh', async () => {
    await service.getTournamentLiveDraw('admin', id, 'presence');
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(service['getTournament']).toHaveBeenCalledTimes(1);
    expect(service['getTournamentRosterForMember']).toHaveBeenCalledWith(
      { registrationClosed: true },
      expect.objectContaining({ memberId: 'admin', role: 'admin' }),
    );
  });

  it('only allows confirmed players/admins to watch and only present players to vote, with duplicate retries idempotent', async () => {
    const state = await schedule();
    await expect(service.getTournamentLiveDraw('spectator', id, 'presence')).rejects.toBeInstanceOf(ForbiddenException);
    await attend();
    await service.getTournamentLiveDraw('admin', id, 'presence');
    now = start;
    const revealed = await service.getTournamentLiveDraw('a', id, 'presence');
    expect(revealed.event).toMatchObject({ phase: 'revealing', eligibleCount: 3, majorityRequired: 2, pools: null, voteResult: null });
    await expect(service.getTournamentLiveDraw('a', id, 'vote', state.event!.eventId)).rejects.toBeInstanceOf(ConflictException);
    now = start + 10_000;
    await expect(service.getTournamentLiveDraw('d', id, 'vote', state.event!.eventId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getTournamentLiveDraw('admin', id, 'vote', state.event!.eventId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getTournamentLiveDraw('a', id, 'vote', 'old-event')).rejects.toBeInstanceOf(ConflictException);
    const voted = await service.getTournamentLiveDraw('a', id, 'vote', state.event!.eventId);
    expect(voted.event).toMatchObject({ phase: 'voting', canVote: false, hasVoted: true, voteResult: null });
    await service.getTournamentLiveDraw('a', id, 'vote', state.event!.eventId);
    expect(storedEvent().rerollVoterIds).toEqual(['a']);
    expect((await service.getTournamentLiveDraw('a', id)).event?.hasVoted).toBe(true);
    const other = await service.getTournamentLiveDraw('b', id);
    expect(other.event?.pools).toEqual(voted.event?.pools);
    expect(other.event?.hasVoted).toBe(false);
  });

  it('handles simultaneous different-player votes without losing votes or creating a second draw', async () => {
    const state = await schedule();
    await attend();
    now = start + 10_000;
    await service.getTournamentLiveDraw('a', id);
    await Promise.all(['a', 'b'].map((player) => service.getTournamentLiveDraw(player, id, 'vote', state.event!.eventId)));
    expect(storedEvent().rerollVoterIds.sort()).toEqual(['a', 'b']);
    const firstVersion = storedEvent().initialDraw!.version;
    now = start + 70_000;
    const results = await service.getTournamentLiveDraw('c', id);
    expect(results.event).toMatchObject({ phase: 'results', voteResult: { rerollVotes: 2, didNotVote: 1, reroll: true } });
    expect(storedEvent().rerollDraw).toBeNull();
    expect(entity.DrawBlobName).toBe('');
    await expect(service.getTournamentLiveDraw('c', id, 'vote', state.event!.eventId)).rejects.toBeInstanceOf(ConflictException);
    now = start + 80_000;
    const reroll = await service.getTournamentLiveDraw('a', id);
    expect(reroll.event?.phase).toBe('rerolling');
    expect(reroll.event?.pools).toBeNull();
    expect(storedEvent().initialDraw!.version).toBe(firstVersion);
    const finalVersion = storedEvent().rerollDraw!.version;
    now = start + 90_000;
    const final = await service.getTournamentLiveDraw('a', id);
    expect(final.event?.phase).toBe('final');
    expect(entity.LiveDrawPublishedVersion).toBe(finalVersion);
    const finalBlobName = String(entity.DrawBlobName);
    const published = JSON.parse(blobs.get(finalBlobName)!.contents.toString());
    expect(published.pools).toEqual(final.event?.pools);
    // Polling again must not overwrite a subsequent administrator-created match schedule.
    entity.DrawBlobName = 'newer-schedule';
    await service.getTournamentLiveDraw('b', id);
    expect(entity.DrawBlobName).toBe('newer-schedule');
    expect(storedEvent().rerollDraw!.version).toBe(finalVersion);
  });

  it('shows the no-reroll decision before finalizing the first draw, including when there are no attendees', async () => {
    await schedule();
    now = start + 70_000;
    const results = await service.getTournamentLiveDraw('admin', id);
    expect(results.event).toMatchObject({ phase: 'results', eligibleCount: 0, voteResult: { reroll: false, rerollVotes: 0 } });
    expect(entity.DrawBlobName).toBe('');
    now = start + 80_000;
    const final = await service.getTournamentLiveDraw('a', id);
    expect(final.event?.phase).toBe('final');
    expect(entity.LiveDrawPublishedVersion).toBe(storedEvent().initialDraw!.version);
    expect(storedEvent().rerollDraw).toBeNull();
  });

  it('invalidates a draw when the roster changes and never publishes stale pools', async () => {
    await schedule();
    await attend();
    roster.teams[0].players[0].memberId = 'replacement';
    now = start + 80_000;
    const state = await service.getTournamentLiveDraw('b', id);
    expect(state.event?.phase).toBe('invalidated');
    expect(state.event?.pools).toBeNull();
    expect(state.event?.canVote).toBe(false);
    expect(entity.LiveDrawPublishedVersion).toBe('');
  });

  it('invalidates on registration reopening and rejects archive/deletion lifecycle access', async () => {
    await schedule();
    closed = false;
    expect((await service.getTournamentLiveDraw('admin', id)).event?.phase).toBe('invalidated');
    entity.LifecycleState = 'Archiving';
    await expect(service.getTournamentLiveDraw('admin', id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks manual pools and schedules while a live draw is pending', async () => {
    await schedule();
    await expect(service.updateTournamentPlanning('admin', id, 'pools', 2, null)).rejects.toThrow('Pools are controlled');
    await expect(service.updateTournamentPlanning('admin', id, 'schedule', 2, null)).rejects.toThrow('Pools are controlled');
  });

  it('reports storage failures rather than acknowledging an unsaved vote', async () => {
    const state = await schedule();
    await attend();
    now = start + 10_000;
    await service.getTournamentLiveDraw('a', id);
    upload.mockRejectedValueOnce(new Error('storage down'));
    await expect(service.getTournamentLiveDraw('a', id, 'vote', state.event!.eventId)).rejects.toBeInstanceOf(BadGatewayException);
    expect(storedEvent().rerollVoterIds).toEqual([]);
    expect(getSession).toHaveBeenCalled();
  });
});
