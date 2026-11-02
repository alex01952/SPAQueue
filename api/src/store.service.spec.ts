import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BlockBlobClient } from '@azure/storage-blob';
import { AppService, type MemberRole } from './app.service';
import { StoreService } from './store.service';

describe('Rewards store', () => {
  let app: AppService;
  let store: StoreService;
  let role: MemberRole;
  const env = { ...process.env };
  const id = '00000000-0000-4000-8000-000000000001';
  const imageUrl =
    'https://testaccount.blob.core.windows.net/spa/store-images/00000000-0000-4000-8000-000000000002.png';
  const valid = {
    name: 'Voucher',
    imageUrl,
    merchantEmail: 'shop@example.com',
    tokenCost: 10,
    enabled: true,
  };
  const entity = {
    partitionKey: 'items',
    rowKey: id,
    Name: 'Voucher',
    ImageUrl: imageUrl,
    MerchantEmail: 'shop@example.com',
    TokenCost: 10,
    Enabled: true,
    etag: 'v1',
  };
  let table: {
    getEntity: jest.Mock;
    createEntity: jest.Mock;
    updateEntity: jest.Mock;
    listEntities: jest.Mock;
  };
  beforeEach(() => {
    process.env.OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT = 'testaccount';
    process.env.OP_PARTICIPATION_AZURE_CONTAINER = 'spa';
    role = 'admin';
    app = new AppService();
    jest.spyOn(app, 'getMemberSession').mockImplementation(() =>
      Promise.resolve({
        authenticated: true,
        member: {
          memberId: 'actor',
          name: 'Actor',
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
    store = new StoreService(app);
    jest.spyOn(store['logger'], 'error').mockImplementation(() => undefined);
    table = {
      getEntity: jest.fn().mockResolvedValue(entity),
      createEntity: jest.fn().mockResolvedValue({}),
      updateEntity: jest.fn().mockResolvedValue({}),
      listEntities: jest.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield await Promise.resolve(entity);
        },
      })),
    };
    Object.defineProperty(store, 'getTable', { value: () => table });
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it.each<MemberRole>(['member', 'balance-staff', 'club-owner'])(
    'denies %s admin listing, changes and image uploads',
    async (value) => {
      role = value;
      await expect(store.list('token', true)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(store.save('token', valid)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(store.uploadImage('token')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(table.createEntity).not.toHaveBeenCalled();
    },
  );

  it('only lists enabled catalog entries and hides merchant addresses from members', async () => {
    table.listEntities.mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield await Promise.resolve({
          ...entity,
          MerchantEmail: 'shop@example.com, team@example.com',
          MerchantCc: 'cc@example.com',
          MerchantBcc: 'private@example.com',
        });
      },
    });
    role = 'member';
    expect(await store.list('token')).toEqual([
      expect.objectContaining({
        name: 'Voucher',
        merchantEmail: '',
        merchantCc: '',
        merchantBcc: '',
      }),
    ]);
    expect(table.listEntities).toHaveBeenCalledWith({
      queryOptions: { filter: "PartitionKey eq 'items' and Enabled eq true" },
    });
  });

  it('reads legacy single-email items with empty copy lists', async () => {
    expect(await store.get(id)).toMatchObject({
      merchantEmail: 'shop@example.com',
      merchantCc: '',
      merchantBcc: '',
    });
  });

  it('supports 254-character addresses and lists up to 10,000 normalized characters', async () => {
    const addresses = Array.from(
      { length: 39 },
      (_, index) =>
        `${String(index).padStart(2, '0')}${'a'.repeat(240)}@example.com`,
    );
    expect(addresses[0]).toHaveLength(254);
    const list = [...addresses, 'last@example.com'].join(', ');
    expect(list).toHaveLength(10_000);
    await store.save('token', {
      ...valid,
      merchantEmail: list,
      merchantCc: list,
      merchantBcc: list,
    });
    expect(table.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        MerchantEmail: list,
        MerchantCc: list,
        MerchantBcc: list,
      }),
    );
    const expandsBeyondLimit = [
      ...addresses,
      `${'b'.repeat(43)}@example.com`,
    ].join(',');
    expect(expandsBeyondLimit).toHaveLength(10_000);
    await expect(
      store.save('token', { ...valid, merchantCc: expandsBeyondLimit }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes and stores multiple merchant To, CC and BCC addresses and exposes them only to admins', async () => {
    await store.save('token', {
      ...valid,
      merchantEmail: ' shop@example.com ; team@example.com, SHOP@example.com ',
      merchantCc: ' cc@example.com; backup@example.com ',
      merchantBcc: ' private@example.com, PRIVATE@example.com ',
    });
    expect(table.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        MerchantEmail: 'shop@example.com, team@example.com',
        MerchantCc: 'cc@example.com, backup@example.com',
        MerchantBcc: 'private@example.com',
      }),
    );
    table.getEntity.mockResolvedValueOnce({
      ...entity,
      MerchantCc: 'cc@example.com',
      MerchantBcc: 'private@example.com',
    });
    expect(await store.get(id)).toMatchObject({
      merchantCc: 'cc@example.com',
      merchantBcc: 'private@example.com',
    });
    await store.save(
      'token',
      { ...valid, merchantCc: '', merchantBcc: '', version: 'v1' },
      id,
    );
    expect(table.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        MerchantCc: '',
        MerchantBcc: '',
      }),
      'Replace',
      { etag: 'v1' },
    );
  });

  it('creates catalog entries and updates/disables them with optimistic concurrency', async () => {
    await store.save('token', valid);
    expect(table.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'items',
        TokenCost: 10,
        UpdatedBy: 'actor',
      }),
    );
    await store.save('token', { ...valid, enabled: false, version: 'v1' }, id);
    expect(table.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ Enabled: false }),
      'Replace',
      { etag: 'v1' },
    );
    await expect(
      store.save('token', { ...valid, version: 'old' }, id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    { name: '' },
    { merchantEmail: 'bad' },
    { merchantEmail: '' },
    { merchantEmail: 'ok@example.com, invalid' },
    { merchantEmail: 'ok@example.com,,next@example.com' },
    { merchantEmail: 'x'.repeat(243) + '@example.com' },
    { merchantEmail: 'a@example.com'.repeat(1_000) },
    { merchantEmail: 'shop@example.com\r\nBcc: injected@example.com' },
    { merchantCc: 'invalid' },
    { merchantCc: ['cc@example.com'] },
    { merchantBcc: 'ok@example.com; invalid' },
    { merchantBcc: 'private@example.com\ninjected@example.com' },
    { tokenCost: 0 },
    { tokenCost: 1.5 },
    { enabled: 'true' },
    { imageUrl: 'https://evil.example.com/image.svg' },
  ])('rejects invalid item details %j', async (change) => {
    await expect(
      store.save('token', { ...valid, ...change }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(table.createEntity).not.toHaveBeenCalled();
  });

  it('reports a genuinely missing item but does not hide a missing table or permission failure', async () => {
    table.getEntity.mockRejectedValueOnce({
      statusCode: 404,
      details: { odataError: { code: 'ResourceNotFound' } },
    });
    await expect(store.get(id)).rejects.toBeInstanceOf(NotFoundException);
    table.getEntity.mockRejectedValueOnce({
      statusCode: 404,
      details: { odataError: { code: 'TableNotFound' } },
    });
    await expect(store.get(id)).rejects.toBeInstanceOf(BadGatewayException);
    table.getEntity.mockRejectedValueOnce({ statusCode: 403 });
    await expect(store.get(id)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('uploads raster images to the existing blob container under store-images', async () => {
    const upload = jest
      .spyOn(BlockBlobClient.prototype, 'uploadData')
      .mockResolvedValue({});
    const buffer = Buffer.from('89504e470d0a1a0a', 'hex');
    const result = await store.uploadImage('token', {
      buffer,
      size: buffer.length,
      mimetype: 'image/png',
    });
    expect(result.imageUrl).toMatch(
      /^https:\/\/testaccount.blob.core.windows.net\/spa\/store-images\/[a-f0-9-]+\.png$/,
    );
    expect(upload).toHaveBeenCalledWith(buffer, {
      blobHTTPHeaders: { blobContentType: 'image/png' },
    });
  });

  it('rejects missing, oversized, SVG and mislabeled images before uploading', async () => {
    const upload = jest
      .spyOn(BlockBlobClient.prototype, 'uploadData')
      .mockResolvedValue({});
    await expect(store.uploadImage('token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    for (const file of [
      {
        buffer: Buffer.from('<svg></svg>'),
        size: 11,
        mimetype: 'image/svg+xml',
      },
      { buffer: Buffer.from('<script>'), size: 8, mimetype: 'image/png' },
      {
        buffer: Buffer.alloc(1),
        size: 6 * 1024 * 1024,
        mimetype: 'image/jpeg',
      },
    ])
      await expect(store.uploadImage('token', file)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    expect(upload).not.toHaveBeenCalled();
  });

  it('uses the existing Mailgun sender and escapes reward receipt HTML', async () => {
    process.env.MAILGUN_API_KEY = 'test-key';
    process.env.MAILGUN_DOMAIN = 'example.com';
    process.env.EMAIL_FROM = 'test@example.com';
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await app.sendRewardRedemptionEmail({
      email: 'shop@example.com; team@example.com',
      cc: 'cc@example.com; backup@example.com',
      bcc: 'private@example.com',
      memberName: '<Player>',
      memberEmail: 'player@example.com',
      itemName: '<img src=x>',
      tokens: 15,
      reference: 'reference-1',
      createdAt: '2026-11-01T00:00:00Z',
    });
    const options = fetch.mock.calls[0][1]!;
    if (!(options.body instanceof URLSearchParams))
      throw new Error('Expected encoded email request body.');
    const body = options.body;
    expect(body.get('to')).toBe('shop@example.com, team@example.com');
    expect(body.get('cc')).toBe('cc@example.com, backup@example.com');
    expect(body.get('bcc')).toBe('private@example.com');
    expect(body.get('text')).not.toContain('private@example.com');
    expect(body.get('html')).not.toContain('private@example.com');
    expect(body.get('text')).toContain('Tokens spent: 15');
    expect(body.get('text')).toContain('reference-1');
    expect(body.get('html')).toContain('&lt;Player&gt;');
    expect(body.get('html')).not.toContain('<img src=x>');
    expect(options.signal).toBeDefined();
    await app.sendRewardRedemptionEmail({
      email: 'player@example.com',
      memberName: 'Player',
      memberEmail: 'player@example.com',
      itemName: 'Voucher',
      tokens: 15,
      reference: 'reference-1',
      createdAt: '',
    });
    const memberBody = fetch.mock.calls[1][1]!.body;
    if (!(memberBody instanceof URLSearchParams))
      throw new Error('Expected encoded body.');
    expect(memberBody.has('cc')).toBe(false);
    expect(memberBody.has('bcc')).toBe(false);
    expect(memberBody.get('to')).toBe('player@example.com');
  });

  it('rejects invalid receipt recipients before contacting Mailgun', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    await expect(
      app.sendRewardRedemptionEmail({
        email: 'shop@example.com',
        bcc: 'private@example.com\r\nTo: injected@example.com',
        memberName: 'Player',
        memberEmail: 'player@example.com',
        itemName: 'Voucher',
        tokens: 15,
        reference: 'reference-1',
        createdAt: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetch).not.toHaveBeenCalled();
  });
});
