import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OpenPlayController } from './open-play.controller';
import { OpenPlayService } from './open-play.service';
import { corsOptions } from './cors.config';

describe('Open Play draft endpoints', () => {
  let app: INestApplication;
  const service = { getDraft: jest.fn(), getBoard: jest.fn(), publishBoardState: jest.fn(), startSession: jest.fn(), endSession: jest.fn(), saveAwardDecision: jest.fn(), recordAwardProgress: jest.fn(), completeAwardReview: jest.fn(), archiveSession: jest.fn(), saveDraft: jest.fn(), getMembers: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [OpenPlayController],
      providers: [{ provide: OpenPlayService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.enableCors(corsOptions);
    await app.init();
  });

  afterEach(async () => { await app.close(); jest.resetAllMocks(); });

  it('forwards the session and prevents caching for reads and writes', async () => {
    const draft = { players: [], revision: null };
    service.getDraft.mockResolvedValue(draft);
    service.saveDraft.mockResolvedValue(draft);
    await request(app.getHttpServer()).get('/open-play/draft').set('Cookie', 'other=1; spaqueue_member_session=token')
      .expect('Cache-Control', 'private, no-store').expect(200, draft);
    await request(app.getHttpServer()).put('/open-play/draft').set('Cookie', 'spaqueue_member_session=token').send(draft)
      .expect('Cache-Control', 'private, no-store').expect(200, draft);
    expect(service.getDraft).toHaveBeenCalledWith('token');
    expect(service.saveDraft).toHaveBeenCalledWith('token', draft);
  });

  it('forwards member sessions to the read-only board without caching', async () => {
    const board = { regularLine: [], winnersLine: [], topFive: [] };
    service.getBoard.mockResolvedValue(board);
    await request(app.getHttpServer()).get('/open-play/board').set('Cookie', 'spaqueue_member_session=member-token')
      .expect('Cache-Control', 'private, no-store').expect(200, board);
    expect(service.getBoard).toHaveBeenCalledWith('member-token');
  });

  it('forwards admin board-state publishes without caching', async () => {
    const state = { forcedCategory: 'High Intermediate', nextPlayerIds: null };
    service.publishBoardState.mockResolvedValue(state);
    await request(app.getHttpServer()).put('/open-play/board-state').set('Cookie', 'spaqueue_member_session=admin-token').send(state)
      .expect('Cache-Control', 'private, no-store').expect(200, state);
    expect(service.publishBoardState).toHaveBeenCalledWith('admin-token', state);
  });

  it('forwards session start, end, award decisions, and completion', async () => {
    const body = { revision: 'revision' };
    service.startSession.mockResolvedValue({ session: { active: true } });
    service.endSession.mockResolvedValue({ session: { active: false } });
    service.saveAwardDecision.mockResolvedValue({ session: { awardReview: { completed: false } } });
    service.recordAwardProgress.mockResolvedValue({ session: { awardReview: { awardedAwardIds: ['member:participation'] } } });
    service.completeAwardReview.mockResolvedValue({ session: { awardReview: { completed: true } } });
    await request(app.getHttpServer()).post('/open-play/session/start').set('Cookie', 'spaqueue_member_session=admin').send(body).expect('Cache-Control', 'private, no-store').expect(201);
    await request(app.getHttpServer()).post('/open-play/session/end').set('Cookie', 'spaqueue_member_session=admin').send(body).expect('Cache-Control', 'private, no-store').expect(201);
    await request(app.getHttpServer()).put('/open-play/session/awards').set('Cookie', 'spaqueue_member_session=admin').send(body).expect(200);
    const progress = { sessionId: 'session', awardId: 'member:participation' };
    await request(app.getHttpServer()).put('/open-play/session/awards/progress').set('Cookie', 'spaqueue_member_session=admin').send(progress)
      .expect('Cache-Control', 'private, no-store').expect(200);
    await request(app.getHttpServer()).post('/open-play/session/awards/complete').set('Cookie', 'spaqueue_member_session=admin').send(body).expect('Cache-Control', 'private, no-store').expect(201);
    expect(service.startSession).toHaveBeenCalledWith('admin', body);
    expect(service.endSession).toHaveBeenCalledWith('admin', body);
    expect(service.saveAwardDecision).toHaveBeenCalledWith('admin', body);
    expect(service.recordAwardProgress).toHaveBeenCalledWith('admin', progress);
    expect(service.completeAwardReview).toHaveBeenCalledWith('admin', body);
  });

  it('forwards an archive request without caching', async () => {
    const body = { sessionId: 'session', revision: 'revision' };
    service.archiveSession.mockResolvedValue({ players: [], matches: [] });
    await request(app.getHttpServer()).post('/open-play/session/archive').set('Cookie', 'spaqueue_member_session=admin').send(body)
      .expect('Cache-Control', 'private, no-store').expect(201);
    expect(service.archiveSession).toHaveBeenCalledWith('admin', body);
  });

  it('forwards the session to the member directory without caching it', async () => {
    service.getMembers.mockResolvedValue([]);
    await request(app.getHttpServer()).get('/open-play/members').set('Cookie', 'spaqueue_member_session=token')
      .expect('Cache-Control', 'private, no-store').expect(200, []);
    expect(service.getMembers).toHaveBeenCalledWith('token');
  });

  it('returns authorization failures', async () => {
    service.saveDraft.mockRejectedValue(new ForbiddenException());
    await request(app.getHttpServer()).put('/open-play/draft').send({}).expect(403);
    expect(service.saveDraft).toHaveBeenCalledWith('', {});
  });

  it('allows credentialed PUT preflight requests', async () => {
    const response = await request(app.getHttpServer()).options('/open-play/draft')
      .set('Origin', 'http://localhost:4200').set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'content-type').expect(204)
      .expect('Access-Control-Allow-Origin', 'http://localhost:4200')
      .expect('Access-Control-Allow-Credentials', 'true');
    expect(response.headers['access-control-allow-methods'].split(',')).toContain('PUT');
  });
});