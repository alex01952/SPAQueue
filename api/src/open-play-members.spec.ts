import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { AppService, MemberRole } from './app.service';

describe('Open Play member directory', () => {
  let service: AppService;
  let role: MemberRole;
  let entities: Record<string, unknown>[];
  const table = { listEntities: jest.fn() };

  beforeEach(() => {
    role = 'admin';
    entities = [
      { rowKey: 'one', Name: 'Jennifer', ReclubId: 'Jenn', Skills: '{"serve":8}', Status: 'Approved', EmailValidated: true, GoldMembershipExpiresOn: '2027-01-01' },
      { rowKey: 'two', Name: 'Pending', Status: 'Pending', EmailValidated: true },
      { rowKey: 'three', Name: 'Unverified', Status: 'Approved', EmailValidated: false },
    ];
    service = new AppService();
    jest.spyOn(service, 'getMemberSession').mockImplementation(async () => ({ authenticated: true, member: { memberId: 'admin', role } } as never));
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    Object.defineProperty(service, 'getMembersTableClient', { value: () => table });
    table.listEntities.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () { for (const entity of entities) yield entity; },
    }));
  });

  afterEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

  it('reads approved members and their matching fields in one table query', async () => {
    expect(await service.getOpenPlayMembers('session')).toEqual([
      { memberId: 'one', name: 'Jennifer', reClubId: 'Jenn', skills: { serve: 8 }, goldMembershipExpiresOn: '2027-01-01' },
    ]);
    expect(table.listEntities).toHaveBeenCalledTimes(1);
    expect(table.listEntities).toHaveBeenCalledWith({ queryOptions: {
      filter: "PartitionKey eq 'members'",
      select: ['RowKey', 'Name', 'ReclubId', 'Skills', 'Status', 'EmailValidated', 'GoldMembershipExpiresOn'],
    } });
  });

  it('returns only requested Gold expiry dates and caches the directory lookup', async () => {
    expect(await service.getOpenPlayGoldMembershipExpiries('session', ['one', 'missing'])).toEqual({ one: '2027-01-01', missing: null });
    expect(await service.getOpenPlayGoldMembershipExpiries('session', ['one'])).toEqual({ one: '2027-01-01' });
    expect(table.listEntities).toHaveBeenCalledTimes(1);
    expect(table.listEntities).toHaveBeenCalledWith({ queryOptions: {
      filter: "PartitionKey eq 'members'",
      select: ['RowKey', 'GoldMembershipExpiresOn'],
    } });
  });

  it('rejects non-admin users before accessing storage', async () => {
    role = 'member';
    await expect(service.getOpenPlayMembers('session')).rejects.toBeInstanceOf(ForbiddenException);
    expect(table.listEntities).not.toHaveBeenCalled();
  });

  it('allows balance staff to load the Open Play member directory', async () => {
    role = 'balance-staff';
    await expect(service.getOpenPlayMembers('session')).resolves.toEqual([
      { memberId: 'one', name: 'Jennifer', reClubId: 'Jenn', skills: { serve: 8 }, goldMembershipExpiresOn: '2027-01-01' },
    ]);
  });

  it('reports storage errors rather than returning an incomplete directory', async () => {
    table.listEntities.mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
    await expect(service.getOpenPlayMembers('session')).rejects.toBeInstanceOf(BadGatewayException);
  });
});