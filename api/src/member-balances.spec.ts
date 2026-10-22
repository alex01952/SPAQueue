import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppService, MemberRole } from './app.service';

describe('Balance staff and daily reminders', () => {
  let service: AppService;
  let role: MemberRole;
  let now: number;
  let serial: number;
  let records: Map<string, Record<string, unknown>>;
  let members: { getEntity: jest.Mock; createEntity: jest.Mock; updateEntity: jest.Mock };
  let sendEmail: jest.SpyInstance;
  let balanceClient: { listEntities: jest.Mock; createEntity: jest.Mock; updateEntity: jest.Mock; deleteEntity: jest.Mock };
  const key = (partition: string, row: string) => `${partition}/${row}`;

  beforeEach(() => {
    service = new AppService();
    role = 'balance-staff';
    now = Date.parse('2026-10-22T08:00:00Z');
    serial = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(service, 'getMemberSession').mockImplementation(async () => ({
      authenticated: true, member: {
        memberId: 'staff', name: 'Staff', role, age: 30, gender: 'Female', duprId: '', reClubId: '',
        profileImageUrl: '', skills: {}, createdAt: '', emailValidated: true,
      },
    }));
    records = new Map([
      [key('members', 'player'), { Email: 'player@example.com', Name: '<Player & Partner>' }],
      [key('members', 'other'), { Email: 'other@example.com', Name: 'Other Player' }],
    ]);
    members = {
      getEntity: jest.fn(async (partition: string, row: string) => {
        const entity = records.get(key(partition, row));
        if (!entity) throw { statusCode: 404 };
        return { ...entity };
      }),
      createEntity: jest.fn(async (entity: Record<string, unknown>) => {
        const id = key(String(entity.partitionKey), String(entity.rowKey));
        if (records.has(id)) throw { statusCode: 409 };
        records.set(id, { ...entity, etag: `v${++serial}` });
      }),
      updateEntity: jest.fn(async (entity: Record<string, unknown>, mode: string, options?: { etag: string }) => {
        const id = key(String(entity.partitionKey), String(entity.rowKey));
        const previous = records.get(id);
        if (!previous) throw { statusCode: 404 };
        if (options && previous.etag !== options.etag) throw { statusCode: 412 };
        records.set(id, { ...(mode === 'Merge' ? previous : {}), ...entity, etag: `v${++serial}` });
      }),
    };
    jest.spyOn(service as any, 'getMembersTableClient').mockReturnValue(members);
    balanceClient = {
      listEntities: jest.fn(() => (async function* () {
        yield { partitionKey: 'player', rowKey: 'court', BalanceType: 'Court <rental>', BalanceDate: '2026-10-20', Amount: 150.25 };
        yield { partitionKey: 'player', rowKey: 'play', Type: 'Open Play', BalanceDate: '2026-10-21', Amount: 200 };
        yield { partitionKey: 'player', rowKey: 'credit', BalanceType: 'Credit', BalanceDate: '2026-10-21', Amount: -50 };
      })()),
      createEntity: jest.fn().mockResolvedValue(undefined),
      updateEntity: jest.fn().mockResolvedValue(undefined),
      deleteEntity: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(service as any, 'getBalancesTableClient').mockReturnValue(balanceClient);
    jest.spyOn(service as any, 'getBalanceTypesTableClient').mockReturnValue({
      listEntities: () => (async function* () { yield { Type: 'Open Play' }; })(),
    });
    sendEmail = jest.spyOn(service as any, 'sendEmail').mockResolvedValue(undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each<MemberRole>(['admin', 'balance-staff'])('allows %s to list, add, edit and delete balances and read types', async (allowed) => {
    role = allowed;
    expect(await service.getBalanceTypes('session')).toEqual(['Open Play']);
    expect(await service.getMemberBalances('session', 'player')).toHaveLength(3);
    const input = { balanceType: 'Open Play', balanceDate: '2026-10-22', amount: 100 };
    expect(await service.createMemberBalance('session', 'player', input)).toMatchObject(input);
    expect(await service.updateMemberBalance('session', 'player', 'existing', input)).toMatchObject(input);
    expect(await service.deleteMemberBalance('session', 'player', 'existing')).toEqual({ deleted: true });
  });

  it.each<MemberRole>(['member', 'club-owner'])('denies %s access to other members balances, mutations and reminders', async (denied) => {
    role = denied;
    const input = { balanceType: 'Open Play', balanceDate: '2026-10-22', amount: 100 };
    const operations = [
      () => service.getBalanceTypes('session'),
      () => service.getMemberBalances('session', 'player'),
      () => service.createMemberBalance('session', 'player', input),
      () => service.updateMemberBalance('session', 'player', 'existing', input),
      () => service.deleteMemberBalance('session', 'player', 'existing'),
      () => service.getMemberBalanceReminderStatus('session', 'player'),
      () => service.remindMemberBalances('session', 'player'),
    ];
    for (const operation of operations) await expect(operation()).rejects.toBeInstanceOf(ForbiddenException);
    expect(balanceClient.listEntities).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('keeps balance staff out of unrelated admin actions and role assignment while preserving their own balances', async () => {
    await expect(service.getPendingMemberRegistrations('session')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getTournamentRegistrationsForAdmin('session')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateMemberRole('session', 'player', 'admin')).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.getMyMemberBalances('session')).toHaveLength(3);
    expect(balanceClient.listEntities).toHaveBeenCalledWith(expect.objectContaining({
      queryOptions: expect.objectContaining({ filter: "PartitionKey eq 'staff'" }),
    }));
    role = 'admin';
    expect(await service.updateMemberRole('session', 'player', 'balance-staff')).toEqual({ memberId: 'player', role: 'balance-staff' });
    expect(service['getMemberRole']({ Role: 'balance-staff' })).toBe('balance-staff');
    await service.updateMemberRole('session', 'player', 'member');
    expect(records.get(key('members', 'player'))!.Role).toBe('member');
  });

  it('sends every balance record with dates, credits, escaped HTML and accurate total only to the member email', async () => {
    const result = await service.remindMemberBalances('session', 'player');
    expect(result).toEqual({ sent: true, nextAllowedAt: new Date(now + 86_400_000).toISOString() });
    const [recipient, subject, text, html] = sendEmail.mock.calls[0] as string[];
    expect(recipient).toBe('player@example.com');
    expect(subject).toContain('unpaid balances');
    for (const value of ['2026-10-20', '2026-10-21', 'Court <rental>', 'Open Play', 'PHP 150.25', 'PHP 200.00', 'PHP -50.00', 'PHP 300.25', '/my-balances']) expect(text).toContain(value);
    expect(html).toContain('&lt;Player &amp; Partner&gt;');
    expect(html).toContain('Court &lt;rental&gt;');
    expect(html).not.toContain('<rental>');
    expect(records.get(key('balance-reminders', 'player'))).toMatchObject({ TriggeredBy: 'staff', NextAllowedAt: result.nextAllowedAt });
  });

  it('enforces a rolling 24-hour limit across admins/staff and reloads, but independently per recipient', async () => {
    expect(await service.getMemberBalanceReminderStatus('session', 'player')).toEqual({ nextAllowedAt: null });
    const result = await service.remindMemberBalances('session', 'player');
    role = 'admin';
    expect(await service.getMemberBalanceReminderStatus('session', 'player')).toEqual({ nextAllowedAt: result.nextAllowedAt });
    now += 86_400_000 - 1;
    await expect(service.remindMemberBalances('session', 'player')).rejects.toBeInstanceOf(ConflictException);
    await service.remindMemberBalances('session', 'other');
    now += 1;
    await service.remindMemberBalances('session', 'player');
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])('prevents simultaneous reminders for the same member (existing reservation: %s)', async (existing) => {
    if (existing) {
      records.set(key('balance-reminders', 'player'), { NextAllowedAt: new Date(now - 1).toISOString(), etag: 'expired' });
    }
    const results = await Promise.allSettled([
      service.remindMemberBalances('one', 'player'), service.remindMemberBalances('two', 'player'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('retains the cooldown on uncertain email delivery and explicitly reports that delivery was not confirmed', async () => {
    sendEmail.mockRejectedValueOnce(new Error('delivery connection lost'));
    await expect(service.remindMemberBalances('session', 'player')).rejects.toThrow('Reminder delivery could not be confirmed');
    await expect(service.remindMemberBalances('session', 'player')).rejects.toBeInstanceOf(ConflictException);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await service.getMemberBalanceReminderStatus('session', 'player')).nextAllowedAt).not.toBeNull();
  });

  it('does not send when persistence fails or cooldown data is invalid', async () => {
    members.createEntity.mockRejectedValueOnce(new Error('storage down'));
    await expect(service.remindMemberBalances('session', 'player')).rejects.toBeInstanceOf(BadGatewayException);
    expect(sendEmail).not.toHaveBeenCalled();
    records.set(key('balance-reminders', 'player'), { NextAllowedAt: 'invalid', etag: 'bad' });
    await expect(service.remindMemberBalances('session', 'player')).rejects.toBeInstanceOf(BadGatewayException);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects invalid member IDs, missing/invalid recipient email and no outstanding balance before reserving', async () => {
    await expect(service.remindMemberBalances('session', "bad'id")).rejects.toBeInstanceOf(BadRequestException);
    records.get(key('members', 'player'))!.Email = '';
    await expect(service.remindMemberBalances('session', 'player')).rejects.toBeInstanceOf(BadRequestException);
    records.get(key('members', 'player'))!.Email = 'player@example.com';
    balanceClient.listEntities.mockImplementation(() => (async function* () {})());
    await expect(service.remindMemberBalances('session', 'player')).rejects.toBeInstanceOf(BadRequestException);
    expect(members.createEntity).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
