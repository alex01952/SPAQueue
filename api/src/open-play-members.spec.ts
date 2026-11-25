import { BadGatewayException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppService, MemberRole } from './app.service';

describe('Open Play member directory', () => {
  let service: AppService;
  let role: MemberRole;
  let entities: Record<string, unknown>[];
  const imageId = '12345678-1234-4234-8234-123456789abc.jpg';
  const table = { listEntities: jest.fn(), getEntity: jest.fn(), updateEntity: jest.fn() };

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
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    Object.defineProperty(service, 'azureStorageAccount', { value: 'account' });
    Object.defineProperty(service, 'azureContainerName', { value: 'spa' });
    Object.defineProperty(service, 'getMembersTableClient', { value: () => table });
    table.listEntities.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () { for (const entity of entities) yield entity; },
    }));
    table.getEntity.mockReset().mockImplementation(async (_partition: string, id: string) => {
      const entity = entities.find((entry) => entry.rowKey === id);
      if (!entity) throw Object.assign(new Error('Missing member'), { statusCode: 404, code: 'ResourceNotFound' });
      return { ...entity };
    });
    table.updateEntity.mockReset().mockImplementation(async (updated: Record<string, unknown>) => {
      const entity = entities.find((entry) => entry.rowKey === updated.rowKey);
      if (entity) Object.assign(entity, updated);
    });
  });

  afterEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); jest.useRealTimers(); });

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

  it('reads only board member fields and shares the cached lookup with Gold expiry requests', async () => {
    role = 'member';
    entities[0].ReclubId = ' Jenn ';
    expect(await service.getOpenPlayBoardMembers('session', ['one', 'missing'])).toEqual({
      one: { reClubId: 'Jenn', goldMembershipExpiresOn: '2027-01-01' },
      missing: { reClubId: '', goldMembershipExpiresOn: null },
    });
    expect(await service.getOpenPlayGoldMembershipExpiries('session', ['one', 'missing'])).toEqual({ one: '2027-01-01', missing: null });
    expect(table.listEntities).toHaveBeenCalledTimes(1);
    expect(table.listEntities).toHaveBeenCalledWith({ queryOptions: {
      filter: "PartitionKey eq 'members'",
      select: ['RowKey', 'ReclubId', 'GoldMembershipExpiresOn'],
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

  it('point-reads only leaderboard profile fields, caches them, and refreshes after expiry', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T02:00:00Z'));
    entities[0].ReclubId = ' Jenn ';
    entities[0].ProfileImageUrl = `https://account.blob.core.windows.net/spa/member-profile-images/one/${imageId}`;
    entities.push({ rowKey: 'external', ReclubId: '', ProfileImageUrl: 'http://127.0.0.1/private' });
    const profiles = await service.getOpenPlayLeaderboardMembers(['one', 'one', 'external', 'missing']);
    expect(profiles).toEqual(new Map([
      ['one', { reClubId: 'Jenn', profileImageId: imageId }],
      ['external', { reClubId: '', profileImageId: '' }],
    ]));
    expect(table.getEntity).toHaveBeenCalledTimes(3);
    expect(table.getEntity).toHaveBeenCalledWith('members', 'one', { queryOptions: { select: ['ReclubId', 'ProfileImageUrl'] } });
    expect(service.getMemberSession).not.toHaveBeenCalled();
    expect(service['logger'].warn).toHaveBeenCalledTimes(2);
    entities[0].ReclubId = 'Updated';
    expect((await service.getOpenPlayLeaderboardMembers(['one'])).get('one')?.reClubId).toBe('Jenn');
    jest.advanceTimersByTime(60_000);
    expect((await service.getOpenPlayLeaderboardMembers(['one'])).get('one')?.reClubId).toBe('Updated');
    expect(table.getEntity).toHaveBeenCalledTimes(4);
  });

  it('invalidates a cached leaderboard profile when the member updates it', async () => {
    expect((await service.getOpenPlayLeaderboardMembers(['one'])).get('one')?.reClubId).toBe('Jenn');
    await service.updateMemberAccount('one', {
      name: 'Jennifer', contactNo: '+639123456789', emergencyContact: '+639987654321',
      birthday: '1990-01-01', showAge: false, locationType: 'Other', location: 'Sorsogon',
      gender: 'Female', duprId: '', reClubId: 'New Reclub', skills: { serve: 8 },
    });
    expect((await service.getOpenPlayLeaderboardMembers(['one'])).get('one')?.reClubId).toBe('New Reclub');
  });

  it('does not retain an old profile read that finishes after an update', async () => {
    let finishRead!: (value: Record<string, unknown>) => void;
    table.getEntity.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const oldRead = service.getOpenPlayLeaderboardMembers(['one']);
    await service.updateMemberAccount('one', {
      name: 'Jennifer', contactNo: '+639123456789', emergencyContact: '+639987654321',
      birthday: '1990-01-01', showAge: false, locationType: 'Other', location: 'Sorsogon',
      gender: 'Female', duprId: '', reClubId: 'New Reclub', skills: { serve: 8 },
    });
    finishRead({ ReclubId: 'Jenn', ProfileImageUrl: '' });
    await oldRead;
    expect((await service.getOpenPlayLeaderboardMembers(['one'])).get('one')?.reClubId).toBe('New Reclub');
  });

  it('surfaces member storage failures rather than treating a missing table as a missing member', async () => {
    table.getEntity.mockRejectedValueOnce(Object.assign(new Error('Missing table'), { statusCode: 404, code: 'TableNotFound' }));
    await expect(service.getOpenPlayLeaderboardMembers(['one'])).rejects.toBeInstanceOf(BadGatewayException);
    expect(service['logger'].error).toHaveBeenCalled();
  });

  it('downloads only bounded profile images and reports missing blobs and storage failures', async () => {
    const blob = {
      getProperties: jest.fn().mockResolvedValue({ contentLength: 3, etag: 'version' }),
      downloadToBuffer: jest.fn().mockResolvedValue(Buffer.from('img')),
    };
    Object.defineProperty(service, 'getLeaderboardProfileImageBlobClient', { value: () => blob });
    expect(await service.getOpenPlayLeaderboardImage('one', imageId)).toEqual({ buffer: Buffer.from('img'), contentType: 'image/jpeg' });
    expect(blob.downloadToBuffer).toHaveBeenCalledWith(0, 3, expect.objectContaining({ conditions: { ifMatch: 'version' } }));
    blob.getProperties.mockResolvedValueOnce({ contentLength: 5 * 1024 * 1024 + 1, etag: 'version' });
    await expect(service.getOpenPlayLeaderboardImage('one', imageId)).rejects.toBeInstanceOf(BadGatewayException);
    blob.getProperties.mockRejectedValueOnce(Object.assign(new Error('Missing image'), { statusCode: 404, code: 'BlobNotFound' }));
    await expect(service.getOpenPlayLeaderboardImage('one', imageId)).rejects.toBeInstanceOf(NotFoundException);
    blob.getProperties.mockRejectedValueOnce(Object.assign(new Error('Missing container'), { statusCode: 404, code: 'ContainerNotFound' }));
    await expect(service.getOpenPlayLeaderboardImage('one', imageId)).rejects.toBeInstanceOf(BadGatewayException);
  });
});