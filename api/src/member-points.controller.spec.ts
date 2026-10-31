import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MemberPointsController } from './member-points.controller';
import { MemberPointsService } from './member-points.service';

describe('Member points endpoints', () => {
  let app: INestApplication;
  const points = { config: jest.fn(), history: jest.fn(), award: jest.fn() };
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [MemberPointsController],
      providers: [{ provide: MemberPointsService, useValue: points }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    jest.resetAllMocks();
  });

  it('forwards credentials to configuration, not mistaken for a member ID', async () => {
    points.config.mockResolvedValue({
      openPlayPoints: 10,
      courtRentalPoints: 5,
    });
    await request(app.getHttpServer())
      .get('/member-points/config')
      .set('Cookie', 'spaqueue_member_session=token')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(points.config).toHaveBeenCalledWith('token');
  });

  it('forwards member, pagination and session to history', async () => {
    points.history.mockResolvedValue({
      awards: [],
      balance: 0,
      continuationToken: null,
    });
    await request(app.getHttpServer())
      .get('/member-points/player?continuation=next')
      .set('Cookie', 'spaqueue_member_session=token')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(points.history).toHaveBeenCalledWith('token', 'player', 'next');
  });

  it('forwards the award request and returns its result', async () => {
    const input = { source: 'CustomAward', points: 3, reason: 'Recognition' };
    points.award.mockResolvedValue({ points: 3 });
    await request(app.getHttpServer())
      .post('/member-points/player')
      .set('Cookie', 'spaqueue_member_session=token')
      .send(input)
      .expect('Cache-Control', 'private, no-store')
      .expect(201, { points: 3 });
    expect(points.award).toHaveBeenCalledWith('token', 'player', input);
  });

  it('surfaces authorization failures rather than accepting an award', async () => {
    points.award.mockRejectedValue(new ForbiddenException());
    await request(app.getHttpServer())
      .post('/member-points/player')
      .send({})
      .expect(403);
    expect(points.award).toHaveBeenCalledWith('', 'player', {});
  });
});
