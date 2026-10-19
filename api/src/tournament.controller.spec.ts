import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('Tournament payment HTTP endpoints', () => {
  let app: INestApplication<App>;
  const service = {
    uploadTournamentPaymentProof: jest.fn(),
    getTournamentPaymentProof: jest.fn(),
    markTournamentRegistrationPaid: jest.fn(),
    removeTournamentRegistration: jest.fn(),
    createTournament: jest.fn(),
    getTournamentTerms: jest.fn(),
    registerTournamentTeam: jest.fn(),
    respondToTournamentInvitation: jest.fn(),
    setTournamentRegistrationClosed: jest.fn(),
    getTournamentRoster: jest.fn(),
    createTournamentProtest: jest.fn(),
    getMyTournamentProtests: jest.fn(),
    getTournamentProtestsForAdmin: jest.fn(),
    reviewTournamentProtest: jest.fn(),
    getTournamentProtestEvidence: jest.fn(),
  };
  const path = '/tournaments/event-1/registrations/captain';
  const cookie = 'spaqueue_member_session=member-session';

  beforeEach(async () => {
    Object.values(service).forEach((mock) => mock.mockReset());
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it('accepts tournament creation with an optional multipart terms PDF', async () => {
    service.createTournament.mockResolvedValue({ termsUrl: '/tournaments/event-1/terms' });
    await request(app.getHttpServer()).post('/admin/tournaments').set('Cookie', cookie)
      .field('name', 'Club Open').field('maxSlots', '8')
      .attach('termsFile', Buffer.from('%PDF-1.7'), { filename: 'terms.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(service.createTournament).toHaveBeenCalledWith('member-session',
      expect.objectContaining({ name: 'Club Open', maxSlots: '8' }),
      expect.objectContaining({ originalname: 'terms.pdf', buffer: Buffer.from('%PDF-1.7') }),
    );
  });

  it('preserves JSON creation without a document', async () => {
    service.createTournament.mockResolvedValue({ name: 'Legacy event' });
    await request(app.getHttpServer()).post('/admin/tournaments').set('Cookie', cookie)
      .send({ name: 'Legacy event' }).expect(201);
    expect(service.createTournament).toHaveBeenCalledWith('member-session', { name: 'Legacy event' }, undefined);
  });

  it('enforces the multipart size limit before calling the service', async () => {
    await request(app.getHttpServer()).post('/admin/tournaments').set('Cookie', cookie)
      .attach('termsFile', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'terms.pdf', contentType: 'application/pdf' })
      .expect(413);
    expect(service.createTournament).not.toHaveBeenCalled();
  });

  it('serves terms as a private inline PDF', async () => {
    const buffer = Buffer.from('%PDF-1.7');
    service.getTournamentTerms.mockResolvedValue(buffer);
    const response = await request(app.getHttpServer()).get('/tournaments/event-1/terms').set('Cookie', cookie)
      .expect(200).expect('Content-Type', 'application/pdf').expect('Content-Disposition', 'inline')
      .expect('Cache-Control', 'private, no-store').expect('X-Content-Type-Options', 'nosniff');
    expect(response.body).toEqual(buffer);
    expect(service.getTournamentTerms).toHaveBeenCalledWith('member-session', 'event-1');
  });

  it('forwards explicit agreement for sender and invitee', async () => {
    service.registerTournamentTeam.mockResolvedValue({});
    service.respondToTournamentInvitation.mockResolvedValue({});
    await request(app.getHttpServer()).post('/tournaments/event-1/registrations').set('Cookie', cookie)
      .send({ partnerId: 'partner', memberExperience: {}, termsAccepted: true }).expect(201);
    expect(service.registerTournamentTeam).toHaveBeenCalledWith('member-session', 'event-1', 'partner', {}, undefined, true);
    await request(app.getHttpServer()).post(`${path}/respond`).set('Cookie', cookie)
      .send({ decision: 'Accepted', partnerExperience: {}, termsAccepted: true }).expect(201);
    expect(service.respondToTournamentInvitation).toHaveBeenCalledWith('member-session', 'event-1', 'captain', 'Accepted', {}, true);
  });

  it('accepts a multipart proof with the session and file bytes', async () => {
    service.uploadTournamentPaymentProof.mockResolvedValue({ status: 'Payment Submitted' });
    await request(app.getHttpServer())
      .post(`${path}/payment-proof`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('receipt'), { filename: 'receipt.pdf', contentType: 'application/pdf' })
      .expect(201)
      .expect({ status: 'Payment Submitted' });
    expect(service.uploadTournamentPaymentProof).toHaveBeenCalledWith(
      'member-session', 'event-1', 'captain',
      expect.objectContaining({ originalname: 'receipt.pdf', mimetype: 'application/pdf', buffer: Buffer.from('receipt') }),
    );
  });

  it('returns a useful error for an empty upload', async () => {
    const response = await request(app.getHttpServer())
      .post(`${path}/payment-proof`)
      .set('Cookie', cookie)
      .expect(400);
    expect(response.body.message).toBe('Select a payment-proof file to upload.');
    expect(service.uploadTournamentPaymentProof).not.toHaveBeenCalled();
  });

  it('serves proof bytes through the authenticated route without public blob access', async () => {
    service.getTournamentPaymentProof.mockResolvedValue({
      buffer: Buffer.from('receipt'), contentType: 'application/pdf',
    });
    const response = await request(app.getHttpServer())
      .get(`${path}/payment-proofs/member-c`)
      .set('Cookie', cookie)
      .expect(200)
      .expect('Content-Type', 'application/pdf')
      .expect('Content-Disposition', 'inline')
      .expect('Cache-Control', 'private, no-store')
      .expect('X-Content-Type-Options', 'nosniff');
    expect(response.body).toEqual(Buffer.from('receipt'));
    expect(service.getTournamentPaymentProof).toHaveBeenCalledWith('member-session', 'event-1', 'captain', 'member-c');
  });

  it('routes admin payment confirmation separately from proof uploads', async () => {
    service.markTournamentRegistrationPaid.mockResolvedValue({ status: 'Paid' });
    await request(app.getHttpServer())
      .patch(`/admin${path}/paid`)
      .set('Cookie', cookie)
      .send({})
      .expect(200)
      .expect({ status: 'Paid' });
    expect(service.markTournamentRegistrationPaid).toHaveBeenCalledWith('member-session', 'event-1', 'captain');
  });

  it('routes admin removal separately from player cancellation', async () => {
    service.removeTournamentRegistration.mockResolvedValue({ deleted: true });
    await request(app.getHttpServer())
      .delete(`/admin${path}`)
      .set('Cookie', cookie)
      .expect(200)
      .expect({ deleted: true });
    expect(service.removeTournamentRegistration).toHaveBeenCalledWith('member-session', 'event-1', 'captain');
  });

  it('lets administrators close registration and players view the roster', async () => {
    service.setTournamentRegistrationClosed.mockResolvedValue({ registrationClosed: true });
    service.getTournamentRoster.mockResolvedValue({ teams: [] });
    await request(app.getHttpServer()).patch('/admin/tournaments/event-1/registration-status').set('Cookie', cookie)
      .send({ closed: true }).expect(200).expect({ registrationClosed: true });
    expect(service.setTournamentRegistrationClosed).toHaveBeenCalledWith('member-session', 'event-1', true);
    await request(app.getHttpServer()).get('/tournaments/event-1/roster').set('Cookie', cookie).expect(200).expect({ teams: [] });
    expect(service.getTournamentRoster).toHaveBeenCalledWith('member-session', 'event-1');
  });

  it('accepts protests with multipart evidence', async () => {
    service.createTournamentProtest.mockResolvedValue({ status: 'Open' });
    await request(app.getHttpServer()).post('/tournaments/event-1/protests').set('Cookie', cookie)
      .field('protestedMemberId', 'rival').field('eligibilityCategory', 'Other').field('reason', 'Detailed reason')
      .attach('evidence', Buffer.from('%PDF-1.7'), { filename: 'proof.pdf', contentType: 'application/pdf' })
      .attach('evidence', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'photo.png', contentType: 'image/png' })
      .expect(201).expect({ status: 'Open' });
    expect(service.createTournamentProtest).toHaveBeenCalledWith('member-session', 'event-1',
      expect.objectContaining({ protestedMemberId: 'rival', eligibilityCategory: 'Other', reason: 'Detailed reason' }),
      [expect.objectContaining({ originalname: 'proof.pdf' }), expect.objectContaining({ originalname: 'photo.png' })],
    );
  });

  it('rejects more than five evidence files before calling the service', async () => {
    let upload = request(app.getHttpServer()).post('/tournaments/event-1/protests').set('Cookie', cookie);
    for (let index = 0; index < 6; index += 1) {
      upload = upload.attach('evidence', Buffer.from('%PDF-1.7'), { filename: `proof-${index}.pdf`, contentType: 'application/pdf' });
    }
    await upload.expect(400);
    expect(service.createTournamentProtest).not.toHaveBeenCalled();
  });

  it('routes protest listing and review', async () => {
    service.getMyTournamentProtests.mockResolvedValue([]);
    service.getTournamentProtestsForAdmin.mockResolvedValue([]);
    service.reviewTournamentProtest.mockResolvedValue({ status: 'Dismissed' });
    await request(app.getHttpServer()).get('/tournaments/event-1/protests/mine').set('Cookie', cookie).expect(200).expect([]);
    expect(service.getMyTournamentProtests).toHaveBeenCalledWith('member-session', 'event-1');
    await request(app.getHttpServer()).get('/admin/tournament-protests').set('Cookie', cookie).expect(200).expect([]);
    expect(service.getTournamentProtestsForAdmin).toHaveBeenCalledWith('member-session');
    await request(app.getHttpServer()).patch('/admin/tournaments/event-1/protests/protest-1').set('Cookie', cookie)
      .send({ status: 'Dismissed', note: 'No evidence of ineligibility' }).expect(200).expect({ status: 'Dismissed' });
    expect(service.reviewTournamentProtest).toHaveBeenCalledWith('member-session', 'event-1', 'protest-1', 'Dismissed', 'No evidence of ineligibility');
  });

  it.each([
    ['image/png', 'inline; filename="photo.png"'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'attachment; filename="photo.png"'],
  ])('serves %s evidence privately', async (contentType, disposition) => {
    service.getTournamentProtestEvidence.mockResolvedValue({ buffer: Buffer.from('data'), contentType, fileName: 'photo.png' });
    await request(app.getHttpServer()).get('/tournaments/event-1/protests/protest-1/evidence/0').set('Cookie', cookie)
      .expect(200).expect('Content-Disposition', disposition)
      .expect('Cache-Control', 'private, no-store').expect('X-Content-Type-Options', 'nosniff');
    expect(service.getTournamentProtestEvidence).toHaveBeenCalledWith('member-session', 'event-1', 'protest-1', 0);
  });
});
