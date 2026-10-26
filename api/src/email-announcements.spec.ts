import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AppService, MemberRole } from './app.service';
import { validateAnnouncement } from './email-announcements';

describe('Email announcements', () => {
  let service: AppService;
  let role: MemberRole;
  let rows: Record<string, unknown>[];
  let records: Map<string, Record<string, unknown>>;
  let sendEmail: jest.Mock;
  let createEntity: jest.Mock;
  let updateEntity: jest.Mock;
  let logError: jest.SpyInstance;
  const requestId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
  const input = {
    subject: 'Club news',
    html: '<h2>Hello</h2><p>Join us!</p>',
    audience: { mode: 'all' },
  };
  const savedEnv = { ...process.env };
  const entity = (id: string, email = `${id}@example.com`) => ({
    partitionKey: 'members',
    rowKey: id,
    Name: `Player ${id}`,
    Email: email,
    Status: 'Approved',
    EmailValidated: true,
  });
  const iterable = (items: Record<string, unknown>[]) =>
    (function* () {
      yield* items;
    })();

  beforeEach(() => {
    role = 'admin';
    service = new AppService();
    rows = [
      entity('one'),
      entity('two'),
      entity('duplicate', 'ONE@example.com'),
      { ...entity('pending'), Status: 'Pending' },
      { ...entity('unverified'), EmailValidated: false },
      entity('invalid', 'bad\r\n@example.com'),
    ];
    records = new Map();
    sendEmail = jest.fn().mockResolvedValue(undefined);
    createEntity = jest.fn((record: Record<string, unknown>) => {
      const id = String(record.rowKey);
      if (records.has(id))
        return Promise.reject(
          Object.assign(new Error('Already exists'), { statusCode: 409 }),
        );
      records.set(id, { ...record });
      return Promise.resolve();
    });
    updateEntity = jest.fn((record: Record<string, unknown>) => {
      const id = String(record.rowKey);
      records.set(id, { ...records.get(id), ...record });
      return Promise.resolve();
    });
    Object.defineProperty(service, 'getMembersTableClient', {
      value: () => ({
        listEntities: () => iterable(rows),
        createEntity,
        updateEntity,
        getEntity: (_partition: string, id: string) => {
          if (!records.has(id))
            return Promise.reject(
              Object.assign(new Error('Not found'), { statusCode: 404 }),
            );
          return Promise.resolve(records.get(id));
        },
      }),
    });
    Object.defineProperty(service, 'getClubsTableClient', {
      value: () => ({
        listEntities: () =>
          iterable([{ rowKey: 'club-one', Name: 'First club' }]),
      }),
    });
    Object.defineProperty(service, 'getClubMembersTableClient', {
      value: () => ({
        listEntities: () => iterable([{ rowKey: 'two', MemberId: 'two' }]),
      }),
    });
    Object.defineProperty(service, 'sendEmail', { value: sendEmail });
    logError = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(service, 'getMemberSession').mockImplementation(() =>
      Promise.resolve({
        authenticated: true,
        member: {
          memberId: 'admin',
          name: 'Admin',
          role,
          age: 30,
          gender: 'Male',
          duprId: '',
          reClubId: '',
          profileImageUrl: '',
          skills: {},
          createdAt: '',
          emailValidated: true,
        },
      }),
    );
    process.env.MAILGUN_API_KEY = 'test-key';
    process.env.MAILGUN_DOMAIN = 'example.com';
    process.env.EMAIL_FROM = 'Club <club@example.com>';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  async function send(body: Record<string, unknown> = input) {
    const preview = await service.previewAnnouncement('session', body);
    return service.sendAnnouncement('session', {
      ...body,
      requestId,
      fingerprint: preview.fingerprint,
    });
  }

  it.each<MemberRole>(['member', 'club-owner', 'balance-staff'])(
    'denies %s every announcement API',
    async (denied) => {
      role = denied;
      await expect(
        service.getAnnouncementRecipients('session'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.previewAnnouncement('session', input),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.sendAnnouncement('session', input),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.getAnnouncementStatus('session', requestId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(createEntity).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );

  it('lists only eligible members but retains users sharing an address for individual selection', async () => {
    expect(
      (await service.getAnnouncementRecipients('session'))
        .map((member) => member.memberId)
        .sort(),
    ).toEqual(['duplicate', 'one', 'two']);
    expect(
      (await service.previewAnnouncement('session', input)).recipientCount,
    ).toBe(2);
  });

  it('uses club assignments rather than the display club name', async () => {
    const body = { ...input, audience: { mode: 'club', clubId: 'club-one' } };
    expect(
      (await service.previewAnnouncement('session', body)).recipientCount,
    ).toBe(1);
    await send(body);
    expect(sendEmail.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      'two@example.com',
    ]);
    await expect(
      service.previewAnnouncement('session', {
        ...input,
        audience: { mode: 'club', clubId: 'missing' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sends to specific users once and rejects unknown, unverified, or pending users', async () => {
    await send({
      ...input,
      audience: { mode: 'users', memberIds: ['one', 'one', 'duplicate'] },
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    for (const id of ['missing', 'pending', 'unverified', 'invalid']) {
      await expect(
        service.previewAnnouncement('session', {
          ...input,
          audience: { mode: 'users', memberIds: [id] },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('counts exactly 50 separate private emails and persists completed status', async () => {
    rows = Array.from({ length: 50 }, (_, i) => entity(`player-${i}`));
    const preview = await service.previewAnnouncement('session', input);
    expect(preview.recipientCount).toBe(50);
    const result = await send();
    expect(result).toEqual({
      requestId,
      status: 'completed',
      total: 50,
      accepted: 50,
      unconfirmed: 0,
    });
    expect(sendEmail).toHaveBeenCalledTimes(50);
    expect(
      new Set(sendEmail.mock.calls.map((call: unknown[]) => call[0])).size,
    ).toBe(50);
    for (const call of sendEmail.mock.calls) {
      expect(call).toEqual([
        expect.stringMatching(/^player-\d+@example\.com$/),
        input.subject,
        'HELLO\n\nJoin us!',
        input.html,
        30_000,
      ]);
    }
    expect(await service.getAnnouncementStatus('session', requestId)).toEqual(
      result,
    );
  });

  it('atomically prevents concurrent duplicate request IDs without resending', async () => {
    const preview = await service.previewAnnouncement('session', input);
    const body = { ...input, requestId, fingerprint: preview.fingerprint };
    const results = await Promise.allSettled([
      service.sendAnnouncement('session', body),
      service.sendAnnouncement('session', body),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      ConflictException,
    );
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('submits one private recipient through the existing Mailgun transport with a timeout', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    const transport = new AppService();
    await transport['sendEmail'](
      'one@example.com',
      'Club news',
      'Hello',
      '<p>Hello</p>',
      30_000,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${process.env.MAILGUN_BASE_URL ?? 'https://api.mailgun.net'}/v3/example.com/messages`,
    );
    expect(options?.method).toBe('POST');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const form = options?.body as URLSearchParams;
    expect(form.get('to')).toBe('one@example.com');
    expect(form.has('cc')).toBe(false);
    expect(form.has('bcc')).toBe(false);
    expect(form.get('html')).toBe('<p>Hello</p>');
    expect(form.get('text')).toBe('Hello');
  });

  it('requires re-confirmation when recipients or content change', async () => {
    const preview = await service.previewAnnouncement('session', input);
    rows.push(entity('new'));
    await expect(
      service.sendAnnouncement('session', {
        ...input,
        requestId,
        fingerprint: preview.fingerprint,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createEntity).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('reports partial failures explicitly without retrying ambiguous deliveries', async () => {
    sendEmail.mockRejectedValueOnce(new Error('connection interrupted'));
    const result = await send();
    expect(result).toMatchObject({
      status: 'completed',
      total: 2,
      accepted: 1,
      unconfirmed: 1,
    });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalled();
    expect(await service.getAnnouncementStatus('session', requestId)).toEqual(
      result,
    );
  });

  it('does not send when reservation fails or delivery configuration is absent', async () => {
    delete process.env.MAILGUN_API_KEY;
    await expect(send()).rejects.toBeInstanceOf(BadRequestException);
    expect(createEntity).not.toHaveBeenCalled();
    process.env.MAILGUN_API_KEY = 'test-key';
    createEntity.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(send()).rejects.toThrow();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('stops if progress storage fails, preserving the duplicate-send reservation', async () => {
    rows = Array.from({ length: 12 }, (_, i) => entity(`player-${i}`));
    updateEntity.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(send()).rejects.toThrow();
    expect(sendEmail).toHaveBeenCalledTimes(5);
    expect(records.get(requestId)?.Status).toBe('sending');
    await expect(send()).rejects.toBeInstanceOf(ConflictException);
    expect(sendEmail).toHaveBeenCalledTimes(5);
  });

  it('allows an empty directory but rejects an empty send audience', async () => {
    rows = [];
    expect(await service.getAnnouncementRecipients('session')).toEqual([]);
    await expect(
      service.previewAnnouncement('session', input),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('strips executable HTML, images and unsafe links while generating readable plain text', () => {
    const safe = validateAnnouncement({
      ...input,
      html: '<script>alert(1)</script><style>p{color:red}</style><p onclick="bad()">Hello &amp; welcome</p><img src="x" onerror="bad()"><a href="javascript:alert(1)">Bad</a><a href="https://example.com">Good</a>',
    });
    expect(safe.html).not.toMatch(
      /script|style|onclick|onerror|<img|javascript/,
    );
    expect(safe.html).toContain('href="https://example.com"');
    expect(safe.text).toContain('Hello & welcome');
  });

  it.each([
    null,
    {},
    { ...input, subject: 'x\r\nBcc: other@example.com' },
    { ...input, subject: 'x'.repeat(201) },
    { ...input, html: '<script>hello</script>' },
    { ...input, html: 'x'.repeat(60_001) },
    { ...input, audience: { mode: 'invalid' } },
    { ...input, audience: { mode: 'users', memberIds: [] } },
    { ...input, audience: { mode: 'club', clubId: "club' or 1 eq 1" } },
  ])('rejects invalid runtime input %#', (body) => {
    expect(() => validateAnnouncement(body)).toThrow(BadRequestException);
  });
});
