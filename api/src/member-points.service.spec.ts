import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { TransactionAction } from '@azure/data-tables';
import { AppService, MemberRole } from './app.service';
import { MemberPointsService } from './member-points.service';

describe('Manual member points', () => {
  let service: MemberPointsService;
  let app: AppService;
  let role: MemberRole;
  let expiry: string | null;
  let rows: Map<string, Record<string, unknown>>;
  let version: number;
  let table: {
    getEntity: jest.Mock;
    submitTransaction: jest.Mock;
    listEntities: jest.Mock;
  };
  const env = { ...process.env };
  const input = {
    requestId: '00000000-0000-4000-8000-000000000001',
    source: 'OpenPlayParticipation',
    activityDate: '2026-10-30',
    scheduleName: 'Morning Open Play',
  };
  const anotherRequest = '00000000-0000-4000-8000-000000000002';
  const key = (partition: string, row: string) => `${partition}|${row}`;
  const missing = () =>
    Object.assign(new Error('Entity not found'), {
      statusCode: 404,
      code: 'ResourceNotFound',
    });
  const conflict = () =>
    Object.assign(new Error('Entity already exists'), {
      statusCode: 409,
      code: 'EntityAlreadyExists',
    });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T02:00:00Z'));
    process.env.Open_Play_Point = '10';
    process.env.Court_Rental_Point = '5';
    role = 'balance-staff';
    expiry = '2027-10-31';
    rows = new Map();
    version = 0;
    app = new AppService();
    jest.spyOn(app, 'getMemberSession').mockImplementation(() =>
      Promise.resolve({
        authenticated: true,
        member: {
          memberId: 'staff',
          name: 'Staff Member',
          role,
          age: null,
          gender: '',
          duprId: '',
          reClubId: '',
          profileImageUrl: '',
          skills: {},
          createdAt: '',
          emailValidated: true,
        },
      }),
    );
    jest.spyOn(app, 'getMemberAccount').mockImplementation(() =>
      Promise.resolve({
        memberId: 'player',
        name: 'Player',
        goldMembershipExpiresOn: expiry,
        role: 'member',
        age: null,
        gender: '',
        duprId: '',
        reClubId: '',
        profileImageUrl: '',
        skills: {},
        createdAt: '',
        emailValidated: true,
        email: 'player@example.com',
        contactNo: '',
        emergencyContact: '',
      }),
    );
    service = new MemberPointsService(app);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    table = {
      getEntity: jest.fn((partition: string, row: string) => {
        const entity = rows.get(key(partition, row));
        return entity
          ? Promise.resolve({ ...entity })
          : Promise.reject(missing());
      }),
      submitTransaction: jest.fn((actions: TransactionAction[]) => {
        for (const action of actions) {
          const entity = action[1];
          const existing = rows.get(key(entity.partitionKey, entity.rowKey));
          if (action[0] === 'create' && existing)
            return Promise.reject(conflict());
          if (action[0] === 'update' && existing?.etag !== action[3]?.etag)
            return Promise.reject(
              Object.assign(new Error('ETag mismatch'), { statusCode: 412 }),
            );
        }
        for (const action of actions) {
          const entity = action[1];
          rows.set(key(entity.partitionKey, entity.rowKey), {
            ...entity,
            etag: String(++version),
          });
        }
        return Promise.resolve([]);
      }),
      listEntities: jest.fn(() => ({
        byPage: jest.fn(() => ({
          next: () =>
            Promise.resolve({
              done: false,
              value: Object.assign(
                [...rows.values()].filter((row) =>
                  String(row.rowKey).startsWith('award:'),
                ),
                { continuationToken: 'next-page' },
              ),
            }),
        })),
      })),
    };
    Object.defineProperty(service, 'getTable', { value: () => table });
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each<MemberRole>(['member', 'club-owner'])(
    'denies %s config, history and awards before storage',
    async (denied) => {
      role = denied;
      await expect(service.config('token')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.history('token', 'player')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.award('token', 'player', input),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(table.getEntity).not.toHaveBeenCalled();
    },
  );

  it.each<MemberRole>(['admin', 'balance-staff'])(
    'allows %s access to fixed-point settings',
    async (allowed) => {
      role = allowed;
      expect(await service.config('token')).toEqual({
        openPlayPoints: 10,
        courtRentalPoints: 5,
      });
    },
  );

  it('records an open-play award, actor audit and balance atomically using the configured amount', async () => {
    const result = await service.award('token', 'player', {
      ...input,
      points: 9999,
    });
    expect(result).toMatchObject({
      source: 'OpenPlayParticipation',
      activityDate: '2026-10-30',
      scheduleName: 'Morning Open Play',
      points: 10,
      createdBy: 'staff',
      createdByName: 'Staff Member',
      createdAt: '2026-10-31T02:00:00.000Z',
      startHour: null,
      courtNumber: null,
    });
    expect(rows.get('player|balance')?.Balance).toBe(10);
    expect(table.submitTransaction).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(3);
  });

  it('replays the same request without awarding twice, even if configured points change', async () => {
    const first = await service.award('token', 'player', input);
    process.env.Open_Play_Point = '20';
    expect(await service.award('token', 'player', input)).toEqual(first);
    expect(rows.get('player|balance')?.Balance).toBe(10);
    expect(table.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a request ID for different activity details', async () => {
    await service.award('token', 'player', input);
    await expect(
      service.award('token', 'player', { ...input, scheduleName: 'Evening' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(rows.get('player|balance')?.Balance).toBe(10);
  });

  it('blocks duplicate session awards regardless of case, extra spaces or request ID', async () => {
    await service.award('token', 'player', input);
    await expect(
      service.award('token', 'player', {
        ...input,
        requestId: anotherRequest,
        scheduleName: ' morning   OPEN play ',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(rows.get('player|balance')?.Balance).toBe(10);
    expect(rows.size).toBe(3);
  });

  it('allows different sessions on a date and the same session on another date', async () => {
    await service.award('token', 'player', input);
    await service.award('token', 'player', {
      ...input,
      requestId: anotherRequest,
      scheduleName: 'Evening',
    });
    await service.award('token', 'player', {
      ...input,
      requestId: '00000000-0000-4000-8000-000000000003',
      activityDate: '2026-10-29',
    });
    expect(rows.get('player|balance')?.Balance).toBe(30);
  });

  it('uses member partitions so different members may earn from the same activity', async () => {
    await service.award('token', 'player', input);
    await service.award('token', 'other', input);
    expect(rows.get('other|balance')?.Balance).toBe(10);
    expect(rows.get('player|balance')?.Balance).toBe(10);
  });

  it('records court, hour, date and configured rental points, blocking only matching rentals', async () => {
    const rental = {
      ...input,
      source: 'CourtRental',
      startHour: 16,
      courtNumber: 2,
    };
    const award = await service.award('token', 'player', rental);
    expect(award).toMatchObject({
      points: 5,
      startHour: 16,
      courtNumber: 2,
      scheduleName: '',
    });
    await expect(
      service.award('token', 'player', {
        ...rental,
        requestId: anotherRequest,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.award('token', 'player', {
      ...rental,
      startHour: 17,
      requestId: anotherRequest,
    });
    expect(rows.get('player|balance')?.Balance).toBe(10);
  });

  it('accepts custom positive points and a reason without fixed-point configuration', async () => {
    delete process.env.Open_Play_Point;
    delete process.env.Court_Rental_Point;
    const custom = {
      ...input,
      source: 'CustomAward',
      points: 7,
      reason: ' Volunteer recognition ',
    };
    expect(await service.award('token', 'player', custom)).toMatchObject({
      points: 7,
      reason: 'Volunteer recognition',
      scheduleName: '',
      source: 'CustomAward',
    });
    await service.award('token', 'player', custom);
    expect(rows.get('player|balance')?.Balance).toBe(7);
  });

  it.each([null, '2026-10-30'])(
    'rejects inactive Gold membership %j',
    async (value) => {
      expiry = value;
      await expect(
        service.award('token', 'player', input),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(table.submitTransaction).not.toHaveBeenCalled();
    },
  );

  it('allows Gold membership through its inclusive UTC expiry day', async () => {
    expiry = '2026-10-31';
    await service.award('token', 'player', input);
    expect(rows.get('player|balance')?.Balance).toBe(10);
  });

  it.each([
    null,
    [],
    {},
    { source: 'Other' },
    { activityDate: '2026-02-30' },
    { activityDate: '2026-11-01' },
    { scheduleName: ' ' },
    { requestId: 'bad' },
    { source: 'CourtRental', startHour: 16.5, courtNumber: 1 },
    { source: 'CourtRental', startHour: 24, courtNumber: 1 },
    { source: 'CourtRental', startHour: 16, courtNumber: 0 },
    { source: 'CustomAward', points: -1, reason: 'Reason' },
    { source: 'CustomAward', points: 1.5, reason: 'Reason' },
    { source: 'CustomAward', points: 1, reason: '' },
  ])('rejects invalid input %j without a transaction', async (change) => {
    const data =
      change === null ||
      Array.isArray(change) ||
      (change && !Object.keys(change).length)
        ? change
        : { ...input, ...change };
    await expect(service.award('token', 'player', data)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(table.submitTransaction).not.toHaveBeenCalled();
  });

  it('requires configured positive whole numbers without silently substituting defaults', async () => {
    delete process.env.Open_Play_Point;
    expect((await service.config('token')).openPlayPoints).toBeNull();
    await expect(
      service.award('token', 'player', input),
    ).rejects.toBeInstanceOf(BadRequestException);
    process.env.Open_Play_Point = '0.5';
    await expect(service.config('token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('uses Philippine dates for activity validation at UTC day boundaries', async () => {
    jest.setSystemTime(new Date('2026-10-30T17:00:00Z'));
    await service.award('token', 'player', {
      ...input,
      activityDate: '2026-10-31',
    });
    expect(rows.get('player|balance')?.Balance).toBe(10);
  });

  it('handles concurrent different awards without losing balance updates', async () => {
    await Promise.all([
      service.award('token', 'player', input),
      service.award('token', 'player', {
        ...input,
        requestId: anotherRequest,
        scheduleName: 'Evening',
      }),
    ]);
    expect(rows.get('player|balance')?.Balance).toBe(20);
    expect(
      [...rows.values()].filter((row) => row.TransactionType === 'Earn'),
    ).toHaveLength(2);
  });

  it('handles concurrent retries of one request exactly once', async () => {
    const results = await Promise.all([
      service.award('token', 'player', input),
      service.award('token', 'player', input),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(rows.get('player|balance')?.Balance).toBe(10);
  });

  it('surfaces uncertain storage errors and recovers an already committed request on retry', async () => {
    const submit = table.submitTransaction.getMockImplementation()!;
    table.submitTransaction.mockImplementationOnce(
      (actions: TransactionAction[]) => {
        submit(actions);
        return Promise.reject(new Error('Lost response after commit'));
      },
    );
    await expect(
      service.award('token', 'player', input),
    ).rejects.toBeInstanceOf(BadGatewayException);
    await service.award('token', 'player', input);
    expect(rows.get('player|balance')?.Balance).toBe(10);
  });

  it('does not silently treat a missing table or storage permission error as zero balance', async () => {
    table.getEntity.mockRejectedValue({
      statusCode: 404,
      code: 'TableNotFound',
    });
    await expect(
      service.award('token', 'player', input),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(table.submitTransaction).not.toHaveBeenCalled();
  });

  it('returns audited paged history and its independently maintained balance', async () => {
    await service.award('token', 'player', input);
    const history = await service.history('token', 'player', 'previous');
    expect(history).toMatchObject({
      balance: 10,
      memberName: 'Player',
      continuationToken: 'next-page',
    });
    expect(history.awards).toHaveLength(1);
    expect(table.listEntities).toHaveBeenCalledWith({
      queryOptions: {
        filter:
          "PartitionKey eq 'player' and RowKey ge 'award:' and RowKey lt 'award;'",
      },
    });
  });

  it('rejects invalid member IDs before constructing table filters', async () => {
    await expect(service.history('token', "bad'id")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.award('token', '../bad', input),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(table.getEntity).not.toHaveBeenCalled();
  });
});
