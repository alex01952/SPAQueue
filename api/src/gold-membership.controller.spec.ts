import { ForbiddenException, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GoldMembershipController } from './gold-membership.controller';
import { GoldMembershipService } from './gold-membership.service';

describe('Gold membership endpoint', () => {
  let app: INestApplication;
  const service = { updateMemberGoldMembership: jest.fn(), getGoldMembershipEmailTemplates: jest.fn() };
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  describe('Gold membership application endpoints', () => {
    let app: INestApplication;
    const service = {
      state: jest.fn(), applications: jest.fn(), submit: jest.fn(), review: jest.fn(),
      receipt: jest.fn(), document: jest.fn(), uploadDocument: jest.fn(),
    };
    beforeEach(async () => {
      const module = await Test.createTestingModule({
        controllers: [GoldMembershipController], providers: [{ provide: GoldMembershipService, useValue: service }],
      }).compile();
      app = module.createNestApplication();
      await app.init();
    });

    describe('Gold application HTTP workflow', () => {
      it.each(['receipt', 'arena-counter'])('persists a %s application and atomically activates membership through admin approval', async (paymentMethod) => {
        let version = 1;
        let member: Record<string, unknown> = { rowKey: 'player', Name: 'Player', ReclubId: 'Ace', Role: 'member', etag: '1' };
        let document: Record<string, unknown> | null = null;
        const files = new Map<string, Buffer>();
        const table = {
          getEntity: async (partition: string, id: string) => {
            if (partition === 'members' && id === 'player') return { ...member };
            if (partition === 'gold-membership-settings' && document) return { ...document };
            throw Object.assign(new Error('Missing'), { statusCode: 404, code: 'ResourceNotFound' });
          },
          upsertEntity: async (entity: Record<string, unknown>) => { document = { ...entity }; },
          updateEntity: async (entity: Record<string, unknown>, _mode: string, options: { etag: string }) => {
            if (member.etag !== options.etag) throw Object.assign(new Error('Changed'), { statusCode: 412 });
            member = { ...member, ...entity, etag: String(++version) };
          },
          listEntities: () => (async function* () { yield { ...member }; })(),
        };
        const container = {
          getProperties: async () => ({}),
          getBlockBlobClient: (name: string) => ({
            uploadData: async (buffer: Buffer) => { files.set(name, Buffer.from(buffer)); },
            getProperties: async () => ({ contentLength: files.get(name)?.length, etag: 'blob-version' }),
            downloadToBuffer: async () => files.get(name),
          }),
        };
        const module = await Test.createTestingModule({
          controllers: [GoldMembershipController],
          providers: [GoldMembershipService, { provide: AppService, useValue: {
            getMemberSession: async (token: string) => {
              if (!token) throw new UnauthorizedException();
              return { member: { memberId: token === 'admin' ? 'admin' : token === 'other' ? 'other' : 'player', role: token === 'admin' ? 'admin' : 'member' } };
            },
          } }],
        }).compile();
        const service = module.get(GoldMembershipService);
        Object.defineProperty(service, 'table', { value: () => table });
        Object.defineProperty(service, 'container', { value: () => container });
        const app = module.createNestApplication();
        await app.init();
        try {
          const http = request(app.getHttpServer());
          await http.get('/gold-membership').expect(401);
          await http.put('/gold-membership/document').set('Cookie', 'spaqueue_member_session=admin')
            .attach('document', Buffer.from('%PDF-1.7\nBenefits and rate'), 'benefits.pdf').expect(200);
          const id = '12345678-1234-4234-8234-123456789abc';
          const submission = http.post('/gold-membership/applications').set('Cookie', 'spaqueue_member_session=member')
            .field('requestId', id).field('paymentMethod', paymentMethod);
          if (paymentMethod === 'receipt') submission.attach('receipt', Buffer.from('%PDF-1.7\nPaid'), 'receipt.pdf');
          const submitted = await submission.expect(201);
          expect(submitted.body.status).toBe('Pending');
          expect(submitted.body.paymentMethod).toBe(paymentMethod);
          const pending = await http.get('/gold-membership/applications?status=Pending').set('Cookie', 'spaqueue_member_session=admin').expect(200);
          expect(pending.body).toHaveLength(1);
          await http.get(`/gold-membership/applications/player/${id}/receipt`).set('Cookie', 'spaqueue_member_session=other').expect(403);
          const receiptRequest = http.get(`/gold-membership/applications/player/${id}/receipt`).set('Cookie', 'spaqueue_member_session=member');
          if (paymentMethod === 'receipt') await receiptRequest.expect('Content-Type', 'application/pdf').expect(200);
          else await receiptRequest.expect(404);
          const approved = await http.patch(`/gold-membership/applications/player/${id}/approve`)
            .set('Cookie', 'spaqueue_member_session=admin').expect(200);
          const state = await http.get('/gold-membership').set('Cookie', 'spaqueue_member_session=member').expect(200);
          expect(state.body.activeGold).toBe(true);
          expect(state.body.application.status).toBe('Approved');
          expect(state.body.goldMembershipExpiresOn).toBe(approved.body.expiresOn);
          expect(member.Role).toBe('member');
          expect(files.size).toBe(paymentMethod === 'receipt' ? 2 : 1);
        } finally { await app.close(); }
      });
    });
    afterEach(async () => { await app.close(); jest.resetAllMocks(); });

    it('forwards the session, filter and explicit review decision without caching', async () => {
      service.state.mockResolvedValue({ activeGold: false });
      service.applications.mockResolvedValue([]);
      await request(app.getHttpServer()).get('/gold-membership').set('Cookie', 'spaqueue_member_session=token')
        .expect('Cache-Control', 'private, no-store').expect(200);
      await request(app.getHttpServer()).get('/gold-membership/applications?status=Pending').set('Cookie', 'spaqueue_member_session=token').expect(200);
      await request(app.getHttpServer()).patch('/gold-membership/applications/player/id/approve').set('Cookie', 'spaqueue_member_session=token').expect(200);
      await request(app.getHttpServer()).patch('/gold-membership/applications/player/id/decline').set('Cookie', 'spaqueue_member_session=token').send({ reason: 'Unreadable' }).expect(200);
      expect(service.state).toHaveBeenCalledWith('token');
      expect(service.applications).toHaveBeenCalledWith('token', 'Pending');
      expect(service.review).toHaveBeenCalledWith('token', 'player', 'id', 'Approved');
      expect(service.review).toHaveBeenCalledWith('token', 'player', 'id', 'Declined', 'Unreadable');
    });

    it('accepts multipart receipts and PDF documents', async () => {
      await request(app.getHttpServer()).post('/gold-membership/applications').set('Cookie', 'spaqueue_member_session=member')
        .field('requestId', 'request').attach('receipt', Buffer.from('%PDF-1.7\nreceipt'), 'receipt.pdf').expect(201);
      expect(service.submit).toHaveBeenCalledWith('member', 'request', expect.objectContaining({ originalname: 'receipt.pdf', buffer: expect.any(Buffer) }), undefined);
      await request(app.getHttpServer()).put('/gold-membership/document').set('Cookie', 'spaqueue_member_session=admin')
        .attach('document', Buffer.from('%PDF-1.7\nbenefits'), 'benefits.pdf').expect(200);
      expect(service.uploadDocument).toHaveBeenCalledWith('admin', expect.objectContaining({ originalname: 'benefits.pdf' }));
    });

    it('forwards counter payments without a receipt', async () => {
      await request(app.getHttpServer()).post('/gold-membership/applications').set('Cookie', 'spaqueue_member_session=member')
        .field('requestId', 'request').field('paymentMethod', 'arena-counter').expect(201);
      expect(service.submit).toHaveBeenCalledWith('member', 'request', undefined, 'arena-counter');
    });

    it('serves authenticated file bytes with private no-store and nosniff headers', async () => {
      service.receipt.mockResolvedValue({ buffer: Buffer.from('image'), contentType: 'image/png' });
      await request(app.getHttpServer()).get('/gold-membership/applications/player/id/receipt').set('Cookie', 'spaqueue_member_session=member')
        .expect('Cache-Control', 'private, no-store').expect('X-Content-Type-Options', 'nosniff').expect('Content-Type', 'image/png').expect(200);
      expect(service.receipt).toHaveBeenCalledWith('member', 'player', 'id');
    });
  });
  afterEach(async () => { await app.close(); jest.resetAllMocks(); });

  it('lists templates with admin session credentials and prevents caching', async () => {
    const templates = [{ name: 'email-templates/gold.html', displayName: 'gold.html' }];
    service.getGoldMembershipEmailTemplates.mockResolvedValue(templates);
    await request(app.getHttpServer()).get('/admin/gold-membership/email-templates')
      .set('Cookie', 'spaqueue_member_session=admin-session')
      .expect('Cache-Control', 'private, no-store').expect(200, templates);
    expect(service.getGoldMembershipEmailTemplates).toHaveBeenCalledWith('admin-session');
  });

  it('surfaces forbidden template access', async () => {
    service.getGoldMembershipEmailTemplates.mockRejectedValue(new ForbiddenException());
    await request(app.getHttpServer()).get('/admin/gold-membership/email-templates').expect(403);
  });

  it.each([{}, { expiresOn: '2027-10-28' }, { expiresOn: null }, { emailTemplate: 'email-templates/gold.html' }])('forwards credentials, member and payload %j', async (body) => {
    const result = { memberId: 'player', goldMembershipExpiresOn: body.expiresOn ?? null };
    service.updateMemberGoldMembership.mockResolvedValue(result);
    await request(app.getHttpServer()).patch('/members/player/gold-membership')
      .set('Cookie', 'spaqueue_member_session=admin-session')
      .send(body).expect('Cache-Control', 'private, no-store').expect(200, result);
    expect(service.updateMemberGoldMembership).toHaveBeenCalledWith('admin-session', 'player', body);
  });

  it('surfaces forbidden mutations instead of reporting success', async () => {
    service.updateMemberGoldMembership.mockRejectedValue(new ForbiddenException());
    await request(app.getHttpServer()).patch('/members/player/gold-membership').send({}).expect(403);
    expect(service.updateMemberGoldMembership).toHaveBeenCalledWith('', 'player', {});
  });
});
