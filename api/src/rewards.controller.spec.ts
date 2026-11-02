import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Server } from 'node:http';
import request from 'supertest';
import { MemberPointsService } from './member-points.service';
import { RewardsController } from './rewards.controller';
import { StoreService } from './store.service';

describe('Rewards endpoints', () => {
  let app: INestApplication;
  let server: Server;
  const points = {
    wallet: jest.fn(),
    myHistory: jest.fn(),
    convert: jest.fn(),
    redeem: jest.fn(),
    retryEmails: jest.fn(),
    adminRedemptions: jest.fn(),
  };
  const store = { list: jest.fn(), save: jest.fn(), uploadImage: jest.fn() };
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [RewardsController],
      providers: [
        { provide: MemberPointsService, useValue: points },
        { provide: StoreService, useValue: store },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });
  afterEach(async () => {
    await app.close();
    jest.resetAllMocks();
  });
  const cookie = 'spaqueue_member_session=token';

  it('gets only the session wallet and forwards history pagination without accepting a member ID', async () => {
    points.wallet.mockResolvedValue({ tokens: 10 });
    await request(server)
      .get('/my-rewards?memberId=someone-else')
      .set('Cookie', cookie)
      .expect('Cache-Control', 'private, no-store')
      .expect(200, { tokens: 10 });
    expect(points.wallet).toHaveBeenCalledWith('token');
    await request(server)
      .get('/my-rewards/history?kind=redemption&continuation=next')
      .set('Cookie', cookie)
      .expect(200);
    expect(points.myHistory).toHaveBeenCalledWith(
      'token',
      'redemption',
      'next',
    );
  });

  it.each(['convert', 'redeem'] as const)(
    'forwards %s requests and authentication',
    async (kind) => {
      const input = { requestId: 'request', points: 10 };
      points[kind].mockResolvedValue({ type: kind });
      await request(server)
        .post(`/my-rewards/${kind}`)
        .set('Cookie', cookie)
        .send(input)
        .expect(201, { type: kind });
      expect(points[kind]).toHaveBeenCalledWith('token', input);
    },
  );

  it('separates member and admin catalogs and propagates denials', async () => {
    await request(server).get('/store').set('Cookie', cookie).expect(200);
    expect(store.list).toHaveBeenCalledWith('token');
    store.list.mockRejectedValueOnce(new ForbiddenException());
    await request(server).get('/admin/store').set('Cookie', cookie).expect(403);
    expect(store.list).toHaveBeenCalledWith('token', true);
  });

  it('forwards catalog creation, edits and multipart image uploads', async () => {
    await request(server)
      .post('/admin/store')
      .set('Cookie', cookie)
      .send({ name: 'Voucher' })
      .expect(201);
    expect(store.save).toHaveBeenCalledWith('token', { name: 'Voucher' });
    await request(server)
      .patch('/admin/store/item')
      .set('Cookie', cookie)
      .send({ enabled: false })
      .expect(200);
    expect(store.save).toHaveBeenCalledWith(
      'token',
      { enabled: false },
      'item',
    );
    await request(server)
      .post('/admin/store-images')
      .set('Cookie', cookie)
      .attach('image', Buffer.from('test'), {
        filename: 'image.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(store.uploadImage).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({ mimetype: 'image/png', size: 4 }),
    );
  });

  it('routes explicit email retries without creating another redemption', async () => {
    await request(server)
      .post('/my-rewards/redemptions/reference/email')
      .set('Cookie', cookie)
      .send({ confirmResend: true })
      .expect(201);
    expect(points.retryEmails).toHaveBeenCalledWith('token', 'reference', {
      confirmResend: true,
    });
    expect(points.redeem).not.toHaveBeenCalled();
  });

  it('forwards credentials and pagination to the admin redemption list with no caching', async () => {
    points.adminRedemptions.mockResolvedValue({
      records: [],
      continuationToken: 'next',
    });
    await request(server)
      .get('/admin/redemptions?continuation=previous')
      .set('Cookie', cookie)
      .expect('Cache-Control', 'private, no-store')
      .expect(200, { records: [], continuationToken: 'next' });
    expect(points.adminRedemptions).toHaveBeenCalledWith('token', 'previous');
  });

  it('propagates admin redemption permission failures', async () => {
    points.adminRedemptions.mockRejectedValue(new ForbiddenException());
    await request(server).get('/admin/redemptions').expect(403);
    expect(points.adminRedemptions).toHaveBeenCalledWith('', undefined);
  });
});
