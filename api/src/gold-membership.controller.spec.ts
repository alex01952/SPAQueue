import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from './app.controller';
import { AppService } from './app.service';

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
