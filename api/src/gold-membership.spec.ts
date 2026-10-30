import { BadGatewayException, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppService, MemberRole } from './app.service';

describe('Gold memberships', () => {
  let service: AppService;
  let role: MemberRole;
  let record: Record<string, unknown>;
  let table: { updateEntity: jest.Mock; getEntity: jest.Mock; listEntities: jest.Mock };
  let blob: { getProperties: jest.Mock; downloadToBuffer: jest.Mock };
  let container: { listBlobsFlat: jest.Mock; getBlockBlobClient: jest.Mock };
  let sendEmail: jest.Mock;
  const originalEnv = { ...process.env };
  const templateName = 'email-templates/gold-membership-beta.html';

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-28T15:00:00Z'));
    service = new AppService();
    role = 'admin';
    record = {
      rowKey: 'player', Name: 'Player', Role: 'balance-staff', Status: 'Approved',
      EmailValidated: true, Email: 'player@example.com', ProfileImageUrl: 'photo.jpg',
    };
    process.env.MAILGUN_API_KEY = 'test-key';
    process.env.MAILGUN_DOMAIN = 'example.com';
    process.env.EMAIL_FROM = 'test@example.com';
    blob = {
      getProperties: jest.fn(async () => ({ contentLength: 100, etag: 'version-1' })),
      downloadToBuffer: jest.fn(async () => Buffer.from('<p>Hello {{memberName}}, Gold until {{expiresOn}}.</p>')),
    };
    container = {
      listBlobsFlat: jest.fn(() => (async function* () {
        yield { name: templateName };
        yield { name: 'email-templates/a.HTML' };
        yield { name: 'email-templates/readme.txt' };
        yield { name: 'email-template/wrong.html' };
        yield { name: 'email-templates/../outside.html' };
      })()),
      getBlockBlobClient: jest.fn(() => blob),
    };
    sendEmail = jest.fn(async () => undefined);
    Object.defineProperty(service, 'getEmailTemplateContainerClient', { value: () => container });
    Object.defineProperty(service, 'sendEmail', { value: sendEmail });
    table = {
      updateEntity: jest.fn(async (entity: Record<string, unknown>) => {
        record = { ...record, ...entity };
      }),
      getEntity: jest.fn(async () => ({ ...record })),
      listEntities: jest.fn(() => (async function* () { yield { ...record }; })()),
    };
    Object.defineProperty(service, 'getMembersTableClient', { value: () => table });
    jest.spyOn(service, 'getMemberSession').mockImplementation(async () => ({
      authenticated: true,
      member: {
        memberId: 'admin', name: 'Admin', role, age: null, gender: '', duprId: '',
        reClubId: '', profileImageUrl: '', skills: {}, createdAt: '', emailValidated: true,
      },
    }));
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  afterEach(() => { process.env = { ...originalEnv }; jest.restoreAllMocks(); jest.useRealTimers(); });

  it('lists only HTML templates under the exact plural prefix in sorted order', async () => {
    expect(await service.getGoldMembershipEmailTemplates('session')).toEqual([
      { name: 'email-templates/a.HTML', displayName: 'a.HTML' },
      { name: templateName, displayName: 'gold-membership-beta.html' },
    ]);
    expect(container.listBlobsFlat).toHaveBeenCalledWith({ prefix: 'email-templates/' });
  });

  it.each<MemberRole>(['member', 'club-owner', 'balance-staff'])('denies %s template listing before blob access', async (denied) => {
    role = denied;
    await expect(service.getGoldMembershipEmailTemplates('session')).rejects.toBeInstanceOf(ForbiddenException);
    expect(container.listBlobsFlat).not.toHaveBeenCalled();
  });

  it('surfaces listing failures instead of returning an empty list', async () => {
    container.listBlobsFlat.mockImplementation(() => { throw new Error('Storage unavailable'); });
    await expect(service.getGoldMembershipEmailTemplates('session')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('renders the stored member and exact expiry, escapes HTML, preserves styling and sends after persistence', async () => {
    record.Name = '<Player & Co>';
    blob.downloadToBuffer.mockResolvedValue(Buffer.from('<p style="color: gold">Hello {{ memberName }}, Gold until {{expiresOn}}.</p>'));
    expect(await service.updateMemberGoldMembership('session', 'player', { emailTemplate: templateName })).toEqual({
      memberId: 'player', goldMembershipExpiresOn: '2027-10-28', emailStatus: 'accepted',
    });
    expect(container.getBlockBlobClient).toHaveBeenCalledWith(templateName);
    expect(blob.downloadToBuffer).toHaveBeenCalledWith(0, 100, expect.objectContaining({
      conditions: { ifMatch: 'version-1' },
    }));
    expect(sendEmail).toHaveBeenCalledWith('player@example.com', 'Welcome to Gold Membership!',
      expect.stringContaining('<Player & Co>'), '<p style="color: gold">Hello &lt;Player &amp; Co&gt;, Gold until 2027-10-28.</p>', 30_000);
    expect(table.updateEntity.mock.invocationCallOrder[0]).toBeLessThan(sendEmail.mock.invocationCallOrder[0]);
  });

  it('supports a custom expiry and optional blob subject metadata', async () => {
    blob.getProperties.mockResolvedValue({ contentLength: 100, metadata: { subject: 'Your Gold membership' } });
    await service.updateMemberGoldMembership('session', 'player', { expiresOn: '2028-01-01', emailTemplate: templateName });
    expect(sendEmail).toHaveBeenCalledWith('player@example.com', 'Your Gold membership',
      expect.stringContaining('2028-01-01'), expect.stringContaining('2028-01-01'), 30_000);
  });

  it.each([null, '', 123, '../gold.html', 'email-template/gold.html', 'email-templates/../gold.html', 'email-templates/gold.txt', 'https://example.com/gold.html'])('rejects invalid template selection %j before writing', async (emailTemplate) => {
    await expect(service.updateMemberGoldMembership('session', 'player', { emailTemplate })).rejects.toBeInstanceOf(BadRequestException);
    expect(table.updateEntity).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects sending on removal and never sends without a template', async () => {
    await expect(service.updateMemberGoldMembership('session', 'player', { expiresOn: null, emailTemplate: templateName })).rejects.toBeInstanceOf(BadRequestException);
    await service.updateMemberGoldMembership('session', 'player', {});
    await service.updateMemberGoldMembership('session', 'player', { expiresOn: null });
    expect(blob.getProperties).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each(['missing-email', 'unverified', 'missing-config', 'unknown-placeholder', 'empty-text', 'oversized', 'invalid-subject', 'deleted', 'storage-failure'])('rejects %s before changing membership', async (scenario) => {
    if (scenario === 'missing-email') record.Email = '';
    if (scenario === 'unverified') record.EmailValidated = false;
    if (scenario === 'missing-config') delete process.env.MAILGUN_API_KEY;
    if (scenario === 'unknown-placeholder') blob.downloadToBuffer.mockResolvedValue(Buffer.from('<p>{{unknown}}</p>'));
    if (scenario === 'empty-text') blob.downloadToBuffer.mockResolvedValue(Buffer.from('<p></p>'));
    if (scenario === 'oversized') blob.getProperties.mockResolvedValue({ contentLength: 60_001 });
    if (scenario === 'invalid-subject') blob.getProperties.mockResolvedValue({ contentLength: 100, metadata: { subject: 'Invalid\nsubject' } });
    if (scenario === 'deleted') blob.getProperties.mockRejectedValue({ statusCode: 404 });
    if (scenario === 'storage-failure') blob.getProperties.mockRejectedValue(new Error('Storage unavailable'));
    await expect(service.updateMemberGoldMembership('session', 'player', { emailTemplate: templateName })).rejects.toThrow();
    expect(table.updateEntity).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not send if membership persistence fails', async () => {
    table.updateEntity.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(service.updateMemberGoldMembership('session', 'player', { emailTemplate: templateName })).rejects.toBeInstanceOf(BadGatewayException);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('returns an explicit unconfirmed email status without hiding the saved membership or retrying', async () => {
    sendEmail.mockRejectedValueOnce(new Error('Provider timeout'));
    expect(await service.updateMemberGoldMembership('session', 'player', { emailTemplate: templateName })).toEqual({
      memberId: 'player', goldMembershipExpiresOn: '2027-10-28', emailStatus: 'unconfirmed',
    });
    expect(record.GoldMembershipExpiresOn).toBe('2027-10-28');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(service['logger'].error).toHaveBeenCalled();
  });

  it('defaults to a calendar year from today and persists only membership, preserving profile and role', async () => {
    expect(await service.updateMemberGoldMembership('session', 'player', {})).toEqual({
      memberId: 'player', goldMembershipExpiresOn: '2027-10-28',
    });
    expect(table.updateEntity).toHaveBeenCalledWith({
      partitionKey: 'members', rowKey: 'player', GoldMembershipExpiresOn: '2027-10-28',
    }, 'Merge');
    expect(await service.getMemberProfile('player')).toMatchObject({
      goldMembershipExpiresOn: '2027-10-28', role: 'balance-staff', profileImageUrl: 'photo.jpg',
    });
    expect(await service.getMemberAccount('player')).toMatchObject({ goldMembershipExpiresOn: '2027-10-28' });
    expect(await service.getMemberDirectory('session')).toEqual([
      expect.objectContaining({ memberId: 'player', goldMembershipExpiresOn: '2027-10-28' }),
    ]);
    expect(table.listEntities).toHaveBeenCalledWith(expect.objectContaining({
      queryOptions: expect.objectContaining({ select: expect.arrayContaining(['GoldMembershipExpiresOn']) }),
    }));
  });

  it('clamps a leap-day anniversary to February 28 rather than March 1', async () => {
    jest.setSystemTime(new Date('2028-02-29T23:59:59Z'));
    expect(await service.updateMemberGoldMembership('session', 'player', {})).toMatchObject({
      goldMembershipExpiresOn: '2029-02-28',
    });
  });

  it('accepts custom dates including today and renews from today rather than a saved expiry', async () => {
    await service.updateMemberGoldMembership('session', 'player', { expiresOn: '2028-02-29' });
    expect(record.GoldMembershipExpiresOn).toBe('2028-02-29');
    await service.updateMemberGoldMembership('session', 'player', {});
    expect(record.GoldMembershipExpiresOn).toBe('2027-10-28');
    await service.updateMemberGoldMembership('session', 'player', { expiresOn: '2026-10-28' });
    expect(record.GoldMembershipExpiresOn).toBe('2026-10-28');
  });

  it('removes membership durably without deleting the member or changing their role', async () => {
    await service.updateMemberGoldMembership('session', 'player', { expiresOn: '2027-12-31' });
    expect(await service.updateMemberGoldMembership('session', 'player', { expiresOn: null })).toEqual({
      memberId: 'player', goldMembershipExpiresOn: null,
    });
    expect(record).toMatchObject({ GoldMembershipExpiresOn: '', Role: 'balance-staff', Name: 'Player' });
    expect(await service.getMemberProfile('player')).toMatchObject({ goldMembershipExpiresOn: null });
  });

  it('leaves legacy members without an expiry as regular members and preserves expired dates for display', async () => {
    expect((await service.getMemberProfile('player')).goldMembershipExpiresOn).toBeUndefined();
    record.GoldMembershipExpiresOn = '2025-01-01';
    expect((await service.getMemberProfile('player')).goldMembershipExpiresOn).toBe('2025-01-01');
  });

  it.each<MemberRole>(['member', 'club-owner', 'balance-staff'])('denies %s changes before storage access', async (denied) => {
    role = denied;
    await expect(service.updateMemberGoldMembership('session', 'player', {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateMemberGoldMembership('session', 'player', { expiresOn: null })).rejects.toBeInstanceOf(ForbiddenException);
    expect(table.updateEntity).not.toHaveBeenCalled();
  });

  it.each([
    null, [], '2027-01-01', { expiresOn: true }, { expiresOn: 123 },
    { expiresOn: '' }, { expiresOn: '2026-10-27' }, { expiresOn: '2027-02-29' },
    { expiresOn: '2027-04-31' }, { expiresOn: '2027-13-01' },
    { expiresOn: '2027-1-01' }, { expiresOn: '2027-01-01T00:00:00Z' },
  ])('rejects invalid membership input %j without writing', async (input) => {
    await expect(service.updateMemberGoldMembership('session', 'player', input)).rejects.toBeInstanceOf(BadRequestException);
    expect(table.updateEntity).not.toHaveBeenCalled();
  });

  it('validates member IDs and surfaces missing members and storage errors', async () => {
    await expect(service.updateMemberGoldMembership('session', '../bad', {})).rejects.toBeInstanceOf(BadRequestException);
    table.updateEntity.mockRejectedValueOnce({ statusCode: 404 });
    await expect(service.updateMemberGoldMembership('session', 'missing', {})).rejects.toBeInstanceOf(NotFoundException);
    table.updateEntity.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(service.updateMemberGoldMembership('session', 'player', {})).rejects.toBeInstanceOf(BadGatewayException);
  });
});
