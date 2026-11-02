import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { TransactionAction } from '@azure/data-tables';
import { AppService, MemberRole } from './app.service';
import { MemberPointsService } from './member-points.service';
import { StoreService } from './store.service';

describe('Manual member points', () => {
  let service: MemberPointsService;
  let app: AppService;
  let role: MemberRole;
  let expiry: string | null;
  let rows: Map<string, Record<string, unknown>>;
  let version: number;
  let sessionMemberId: string;
  let store: StoreService;
  let table: {
    getEntity: jest.Mock;
    submitTransaction: jest.Mock<Promise<unknown>, [TransactionAction[]]>;
    listEntities: jest.Mock;
    updateEntity: jest.Mock;
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
      details: { odataError: { code: 'ResourceNotFound' } },
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
    sessionMemberId = 'staff';
    app = new AppService();
    jest.spyOn(app, 'getMemberSession').mockImplementation(() =>
      Promise.resolve({
        authenticated: true,
        member: {
          memberId: sessionMemberId,
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
    store = new StoreService(app);
    service = new MemberPointsService(app, store);
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
            ...(action[0] === 'update'
              ? rows.get(key(entity.partitionKey, entity.rowKey))
              : {}),
            ...entity,
            etag: String(++version),
          });
        }
        return Promise.resolve([]);
      }),
      updateEntity: jest.fn(
        (
          entity: { partitionKey: string; rowKey: string },
          _mode: string,
          options?: { etag: string },
        ) => {
          const existing = rows.get(key(entity.partitionKey, entity.rowKey));
          if (!existing) return Promise.reject(missing());
          if (options?.etag && existing.etag !== options.etag)
            return Promise.reject(
              Object.assign(new Error('ETag mismatch'), { statusCode: 412 }),
            );
          rows.set(key(entity.partitionKey, entity.rowKey), {
            ...existing,
            ...entity,
            etag: String(++version),
          });
          return Promise.resolve({});
        },
      ),
      listEntities: jest.fn((options: { queryOptions: { filter: string } }) => {
        const filter = options.queryOptions.filter;
        const partition = /PartitionKey eq '([^']+)'/.exec(filter)?.[1];
        const prefix = /RowKey ge '([^']+)'/.exec(filter)?.[1];
        const entities = [...rows.values()].filter(
          (row) =>
            (!partition || row.partitionKey === partition) &&
            (!prefix || String(row.rowKey).startsWith(prefix)) &&
            (!filter.includes("Type eq 'redemption'") ||
              row.Type === 'redemption'),
        );
        return {
          [Symbol.asyncIterator]: async function* () {
            yield* await Promise.resolve(entities);
          },
          byPage: jest.fn(() => ({
            next: () =>
              Promise.resolve({
                done: false,
                value: Object.assign(entities, {
                  continuationToken: 'next-page',
                }),
              }),
          })),
        };
      }),
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
        void submit(actions);
        return Promise.reject(new Error('Lost response after commit'));
      },
    );
    await expect(
      service.award('token', 'player', input),
    ).rejects.toBeInstanceOf(BadGatewayException);
    await service.award('token', 'player', input);
    expect(rows.get('player|balance')?.Balance).toBe(10);
  });

  it('also recognizes missing entities with a top-level service error code', async () => {
    table.getEntity.mockRejectedValueOnce({
      statusCode: 404,
      code: 'ResourceNotFound',
    });
    await service.award('token', 'player', input);
    expect(rows.get('player|balance')?.Balance).toBe(10);
  });

  it('returns an empty history when Azure reports a missing balance using OData details', async () => {
    const history = await service.history('token', 'player');
    expect(history.balance).toBe(0);
    expect(history.awards).toEqual([]);
  });

  it.each([
    { statusCode: 404, code: 'TableNotFound' },
    { statusCode: 404, details: { odataError: { code: 'TableNotFound' } } },
    {
      statusCode: 403,
      details: { odataError: { code: 'AuthorizationPermissionMismatch' } },
    },
    { statusCode: 404 },
    { statusCode: 500, details: { odataError: { code: 'ResourceNotFound' } } },
  ])('does not treat storage failure %j as a missing entity', async (error) => {
    table.getEntity.mockRejectedValue(error);
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

  describe('Admin redemption history', () => {
    const redemption = {
      partitionKey: 'player',
      rowKey: 'redemption:0000000000001:request',
      Type: 'redemption',
      MemberName: 'Player at checkout',
      MemberEmail: 'player@example.com',
      MerchantEmail: 'original-merchant@example.com',
      MerchantCc: 'original-cc@example.com',
      MerchantBcc: 'original-bcc@example.com',
      ItemId: 'original-item',
      ItemName: 'Original reward',
      ImageUrl: 'https://example.com/image.png',
      Tokens: 15,
      CreatedAt: '2026-10-30T12:00:00Z',
      MemberEmailStatus: 'accepted',
      MerchantEmailStatus: 'unconfirmed',
    };

    it.each<MemberRole>(['member', 'balance-staff', 'club-owner'])(
      'denies %s before reading cross-member redemption data',
      async (value) => {
        role = value;
        await expect(service.adminRedemptions('token')).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(table.listEntities).not.toHaveBeenCalled();
      },
    );

    it('lists redemption snapshots across members without looking up current catalog or accounts', async () => {
      role = 'admin';
      rows.set('player|redemption:1', redemption);
      rows.set('another|redemption:2', {
        ...redemption,
        partitionKey: 'another',
        MemberName: 'Another member',
      });
      rows.set('player|conversion:1', {
        ...redemption,
        rowKey: 'conversion:1',
        Type: 'conversion',
      });
      const getItem = jest.spyOn(store, 'get');
      const result = await service.adminRedemptions('token', 'previous');
      expect(result.records).toHaveLength(2);
      expect(result.records[0]).toMatchObject({
        memberId: 'player',
        memberName: 'Player at checkout',
        memberEmail: 'player@example.com',
        merchantEmail: 'original-merchant@example.com',
        merchantCc: 'original-cc@example.com',
        merchantBcc: 'original-bcc@example.com',
        itemName: 'Original reward',
        tokens: 15,
        transactionId: redemption.rowKey,
        merchantEmailStatus: 'unconfirmed',
      });
      expect(result.records[1].memberId).toBe('another');
      expect(table.listEntities).toHaveBeenCalledWith({
        queryOptions: {
          filter:
            "RowKey ge 'redemption:' and RowKey lt 'redemption;' and Type eq 'redemption'",
        },
      });
      expect(getItem).not.toHaveBeenCalled();
      expect(table.getEntity).not.toHaveBeenCalled();
      expect(result.continuationToken).toBe('next-page');
    });

    it('uses bounded pages and retains continuation tokens for empty storage pages', async () => {
      role = 'admin';
      const byPage = jest.fn().mockReturnValue({
        next: () =>
          Promise.resolve({
            done: false,
            value: Object.assign([], { continuationToken: 'keep-going' }),
          }),
      });
      table.listEntities.mockReturnValueOnce({ byPage });
      expect(await service.adminRedemptions('token', 'previous')).toEqual({
        records: [],
        continuationToken: 'keep-going',
      });
      expect(byPage).toHaveBeenCalledWith({
        maxPageSize: 50,
        continuationToken: 'previous',
      });
    });

    it('returns a final empty page without a continuation token', async () => {
      role = 'admin';
      table.listEntities.mockReturnValueOnce({
        byPage: () => ({ next: () => Promise.resolve({ done: true }) }),
      });
      expect(await service.adminRedemptions('token')).toEqual({
        records: [],
        continuationToken: null,
      });
    });

    it('rejects invalid continuation values and surfaces storage failures', async () => {
      role = 'admin';
      await expect(
        service.adminRedemptions('token', 'x'.repeat(10_001)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(table.listEntities).not.toHaveBeenCalled();
      table.listEntities.mockImplementationOnce(() => {
        throw new Error('Storage unavailable');
      });
      await expect(service.adminRedemptions('token')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  describe('Member token wallet', () => {
    let sendReceipt: jest.SpiedFunction<
      AppService['sendRewardRedemptionEmail']
    >;
    let getItem: jest.SpiedFunction<StoreService['get']>;
    const item = {
      itemId: '00000000-0000-4000-8000-000000000010',
      name: 'Court voucher',
      imageUrl: 'https://example.com/image.png',
      merchantEmail: 'merchant@example.com',
      merchantCc: '',
      merchantBcc: '',
      tokenCost: 15,
      enabled: true,
      version: 'v1',
    };
    const conversion = { requestId: input.requestId, points: 60 };
    const purchase = {
      requestId: anotherRequest,
      itemId: item.itemId,
      version: item.version,
    };
    beforeEach(() => {
      role = 'member';
      sessionMemberId = 'player';
      rows.set('player|balance', {
        partitionKey: 'player',
        rowKey: 'balance',
        Balance: 100,
        etag: 'initial',
      });
      rows.set('player|award:1', {
        partitionKey: 'player',
        rowKey: 'award:1',
        Points: 50,
        Source: 'CustomAward',
        RequestId: input.requestId,
        CreatedAt: '2026-10-29T00:00:00Z',
      });
      rows.set('player|award:2', {
        partitionKey: 'player',
        rowKey: 'award:2',
        Points: 50,
        Source: 'CustomAward',
        RequestId: anotherRequest,
        CreatedAt: '2026-10-30T00:00:00Z',
      });
      process.env.MAILGUN_API_KEY = 'test-key';
      process.env.MAILGUN_DOMAIN = 'example.com';
      process.env.EMAIL_FROM = 'test@example.com';
      getItem = jest.spyOn(store, 'get').mockResolvedValue(item);
      sendReceipt = jest
        .spyOn(app, 'sendRewardRedemptionEmail')
        .mockResolvedValue(undefined);
    });

    it('converts only the requested amount and derives partial/full use of legacy awards', async () => {
      await service.convert('token', conversion);
      expect(await service.wallet('token')).toMatchObject({
        points: 40,
        tokens: 60,
        convertedPoints: 60,
      });
      const history = await service.myHistory('token', 'award');
      expect(history.records).toEqual([
        expect.objectContaining({
          awardId: 'award:1',
          convertedPoints: 50,
          used: true,
        }),
        expect.objectContaining({
          awardId: 'award:2',
          convertedPoints: 10,
          used: false,
        }),
      ]);
      const transactions = await service.myHistory('token', 'conversion');
      expect(transactions.records).toEqual([
        expect.objectContaining({ points: 60, tokens: 60 }),
      ]);
    });

    it('replays a conversion once and rejects changed details using the same ID', async () => {
      const result = await service.convert('token', conversion);
      expect(await service.convert('token', conversion)).toEqual(result);
      await expect(
        service.convert('token', { ...conversion, points: 50 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect((await service.wallet('token')).tokens).toBe(60);
    });

    it('prevents concurrent conversions from double spending', async () => {
      const outcomes = await Promise.allSettled([
        service.convert('token', conversion),
        service.convert('token', { ...conversion, requestId: anotherRequest }),
      ]);
      expect(
        outcomes.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(await service.wallet('token')).toMatchObject({
        points: 40,
        tokens: 60,
      });
    });

    it('replays concurrent identical conversions exactly once', async () => {
      const results = await Promise.all([
        service.convert('token', conversion),
        service.convert('token', conversion),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect((await service.wallet('token')).tokens).toBe(60);
    });

    it('allows replay of a committed transaction after Gold expires without creating a new conversion', async () => {
      const first = await service.convert('token', conversion);
      expiry = '2026-10-30';
      expect(await service.convert('token', conversion)).toEqual(first);
      await expect(
        service.convert('token', { ...conversion, requestId: anotherRequest }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect((await service.wallet('token')).tokens).toBe(60);
    });

    it('does not silently treat an unavailable wallet table as zero tokens', async () => {
      table.getEntity.mockRejectedValue({
        statusCode: 404,
        details: { odataError: { code: 'TableNotFound' } },
      });
      await expect(service.wallet('token')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      await expect(service.convert('token', conversion)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(table.submitTransaction).not.toHaveBeenCalled();
    });

    it('retains the converted amount when staff add later points', async () => {
      await service.convert('token', conversion);
      role = 'balance-staff';
      sessionMemberId = 'staff';
      await service.award('token', 'player', input);
      role = 'member';
      sessionMemberId = 'player';
      expect(await service.wallet('token')).toMatchObject({
        points: 50,
        tokens: 60,
        convertedPoints: 60,
      });
      const history = await service.myHistory('token', 'award');
      expect(history.records[2]).toMatchObject({
        points: 10,
        convertedPoints: 0,
        used: false,
      });
    });

    it.each([null, '2026-10-30'])(
      'denies conversion and redemption without active Gold (%j), but allows history',
      async (value) => {
        expiry = value;
        await expect(
          service.convert('token', conversion),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.redeem('token', purchase)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect((await service.wallet('token')).points).toBe(100);
        expect(
          (await service.myHistory('token', 'award')).records,
        ).toHaveLength(2);
      },
    );

    it.each([0, -1, 0.5, '5', 101, Number.MAX_SAFE_INTEGER + 1])(
      'rejects invalid or unaffordable conversion amount %j',
      async (points) => {
        await expect(
          service.convert('token', { ...conversion, points }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(table.submitTransaction).not.toHaveBeenCalled();
      },
    );

    it('spends the server item price, records a snapshot and sends separate emails to member and merchant', async () => {
      await service.convert('token', conversion);
      const result = await service.redeem('token', { ...purchase, tokens: 1 });
      expect(result).toMatchObject({
        type: 'redemption',
        itemName: item.name,
        tokens: 15,
        memberEmailStatus: 'accepted',
        merchantEmailStatus: 'accepted',
      });
      expect(await service.wallet('token')).toMatchObject({
        points: 40,
        tokens: 45,
        tokensSpent: 15,
      });
      expect(sendReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'player@example.com',
          reference: result.transactionId,
          tokens: 15,
        }),
      );
      expect(sendReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'merchant@example.com',
          reference: result.transactionId,
        }),
      );
      await service.redeem('token', purchase);
      expect(sendReceipt).toHaveBeenCalledTimes(2);
      expect((await service.wallet('token')).tokens).toBe(45);
    });

    it('preserves completed redemptions when emails fail and retries only unconfirmed recipients without spending', async () => {
      await service.convert('token', conversion);
      sendReceipt.mockRejectedValueOnce(new Error('Mail service timeout'));
      const result = await service.redeem('token', purchase);
      expect(result.memberEmailStatus).toBe('unconfirmed');
      expect(result.merchantEmailStatus).toBe('accepted');
      expect((await service.wallet('token')).tokens).toBe(45);
      await service.redeem('token', purchase);
      expect(sendReceipt).toHaveBeenCalledTimes(2);
      await expect(
        service.retryEmails('token', result.transactionId, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        await service.retryEmails('token', result.transactionId, {
          confirmResend: true,
        }),
      ).toMatchObject({
        memberEmailStatus: 'accepted',
        merchantEmailStatus: 'accepted',
      });
      expect(sendReceipt).toHaveBeenCalledTimes(3);
      expect((await service.wallet('token')).tokens).toBe(45);
    });

    it('snapshots all merchant recipients and retries original lists without exposing copies to the member', async () => {
      const recipients = {
        merchantEmail: 'merchant@example.com, team@example.com',
        merchantCc: 'cc@example.com, backup@example.com',
        merchantBcc: 'private@example.com',
      };
      getItem.mockResolvedValue({ ...item, ...recipients });
      await service.convert('token', conversion);
      sendReceipt.mockImplementation((receipt) =>
        receipt.email === recipients.merchantEmail
          ? Promise.reject(new Error('Unconfirmed merchant delivery'))
          : Promise.resolve(),
      );
      const result = await service.redeem('token', purchase);
      const row = rows.get(`player|${result.transactionId}`)!;
      expect(row).toMatchObject({
        MerchantEmail: recipients.merchantEmail,
        MerchantCc: recipients.merchantCc,
        MerchantBcc: recipients.merchantBcc,
        MerchantEmailStatus: 'unconfirmed',
      });
      const memberReceipt = sendReceipt.mock.calls[0][0];
      expect(memberReceipt.email).toBe('player@example.com');
      expect(memberReceipt).not.toHaveProperty('cc');
      expect(memberReceipt).not.toHaveProperty('bcc');
      expect(result).not.toHaveProperty('merchantBcc');
      expect(
        (await service.myHistory('token', 'redemption')).records[0],
      ).not.toHaveProperty('merchantBcc');
      getItem.mockResolvedValue({
        ...item,
        merchantBcc: 'changed@example.com',
      });
      sendReceipt.mockResolvedValue(undefined);
      await service.retryEmails('token', result.transactionId, {
        confirmResend: true,
      });
      expect(sendReceipt).toHaveBeenLastCalledWith(
        expect.objectContaining({
          email: recipients.merchantEmail,
          cc: recipients.merchantCc,
          bcc: recipients.merchantBcc,
        }),
      );
      expect(sendReceipt).toHaveBeenCalledTimes(3);
      expect((await service.wallet('token')).tokens).toBe(45);
    });

    it('retries legacy redemptions without copy fields using the original single merchant email', async () => {
      await service.convert('token', conversion);
      const result = await service.redeem('token', purchase);
      const row = rows.get(`player|${result.transactionId}`)!;
      delete row.MerchantCc;
      delete row.MerchantBcc;
      row.MerchantEmailStatus = 'unconfirmed';
      sendReceipt.mockClear();
      await service.retryEmails('token', result.transactionId, {
        confirmResend: true,
      });
      expect(sendReceipt).toHaveBeenCalledTimes(1);
      expect(sendReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'merchant@example.com',
          cc: '',
          bcc: '',
        }),
      );
    });

    it('recovers a committed redemption after a lost response without spending twice', async () => {
      await service.convert('token', conversion);
      const submit = table.submitTransaction.getMockImplementation()!;
      table.submitTransaction.mockImplementationOnce(
        (actions: TransactionAction[]) => {
          void submit(actions);
          return Promise.reject(new Error('Lost response'));
        },
      );
      await expect(service.redeem('token', purchase)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect((await service.redeem('token', purchase)).tokens).toBe(15);
      expect((await service.wallet('token')).tokens).toBe(45);
    });

    it('prevents concurrent redemptions from overspending tokens', async () => {
      await service.convert('token', { ...conversion, points: 20 });
      const results = await Promise.allSettled([
        service.redeem('token', purchase),
        service.redeem('token', {
          ...purchase,
          requestId: '00000000-0000-4000-8000-000000000003',
        }),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect((await service.wallet('token')).tokens).toBe(5);
    });

    it('replays concurrent identical purchases without duplicate token charges or notification attempts', async () => {
      await service.convert('token', conversion);
      await Promise.all([
        service.redeem('token', purchase),
        service.redeem('token', purchase),
      ]);
      expect((await service.wallet('token')).tokens).toBe(45);
      expect(sendReceipt).toHaveBeenCalledTimes(2);
      expect(
        (await service.myHistory('token', 'redemption')).records,
      ).toHaveLength(1);
    });

    it('requires a stale sending attempt to expire before explicitly retrying email without spending tokens', async () => {
      await service.convert('token', conversion);
      const redemption = await service.redeem('token', purchase);
      const rowKey = `player|${redemption.transactionId}`;
      const entity = rows.get(rowKey)!;
      rows.set(rowKey, {
        ...entity,
        MemberEmailStatus: 'sending',
        MemberEmailAttemptAt: new Date().toISOString(),
      });
      await service.retryEmails('token', redemption.transactionId, {
        confirmResend: true,
      });
      expect(sendReceipt).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(120_001);
      await service.retryEmails('token', redemption.transactionId, {
        confirmResend: true,
      });
      expect(sendReceipt).toHaveBeenCalledTimes(3);
      expect((await service.wallet('token')).tokens).toBe(45);
    });

    it('rejects disabled or changed items and missing email configuration before spending', async () => {
      await service.convert('token', conversion);
      getItem.mockResolvedValueOnce({ ...item, enabled: false });
      await expect(service.redeem('token', purchase)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(
        service.redeem('token', { ...purchase, version: 'old' }),
      ).rejects.toBeInstanceOf(ConflictException);
      delete process.env.MAILGUN_API_KEY;
      await expect(service.redeem('token', purchase)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect((await service.wallet('token')).tokens).toBe(60);
    });

    it('scopes wallet, history and email retries to the signed-in member', async () => {
      await service.convert('token', conversion);
      const redemption = await service.redeem('token', purchase);
      sessionMemberId = 'someone-else';
      expect(await service.wallet('token')).toMatchObject({
        points: 0,
        tokens: 0,
      });
      expect((await service.myHistory('token', 'redemption')).records).toEqual(
        [],
      );
      await expect(
        service.retryEmails('token', redemption.transactionId, {
          confirmResend: true,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('handles large award histories without updating every earned row in a transaction', async () => {
      rows.delete('player|award:1');
      rows.delete('player|award:2');
      for (let n = 0; n < 150; n++)
        rows.set(`player|award:${n}`, {
          partitionKey: 'player',
          rowKey: `award:${n}`,
          Points: 1,
        });
      rows.set('player|balance', {
        partitionKey: 'player',
        rowKey: 'balance',
        Balance: 150,
        etag: 'legacy',
      });
      await service.convert('token', { ...conversion, points: 149 });
      expect(table.submitTransaction.mock.calls[0][0]).toHaveLength(3);
      const history = await service.myHistory('token', 'award');
      expect(
        history.records.filter((row) => 'used' in row && row.used),
      ).toHaveLength(149);
    });
  });
});
