import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('Balance reminder HTTP endpoints', () => {
  let app: INestApplication;
  const service = {
    getMemberBalanceReminderStatus: jest.fn(),
    remindMemberBalances: jest.fn(),
  };
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AppController], providers: [{ provide: AppService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => { await app.close(); jest.clearAllMocks(); });

  it('forwards the cookie and target member with private, non-cacheable reminder responses', async () => {
    const nextAllowedAt = '2026-10-23T08:00:00Z';
    service.getMemberBalanceReminderStatus.mockResolvedValue({ nextAllowedAt });
    service.remindMemberBalances.mockResolvedValue({ sent: true, nextAllowedAt });
    await request(app.getHttpServer()).get('/members/player/balance-reminder')
      .set('Cookie', 'spaqueue_member_session=staff-session')
      .expect('Cache-Control', 'private, no-store').expect(200, { nextAllowedAt });
    expect(service.getMemberBalanceReminderStatus).toHaveBeenCalledWith('staff-session', 'player');
    await request(app.getHttpServer()).post('/members/player/balance-reminder')
      .set('Cookie', 'spaqueue_member_session=staff-session')
      .expect('Cache-Control', 'private, no-store').expect(201, { sent: true, nextAllowedAt });
    expect(service.remindMemberBalances).toHaveBeenCalledWith('staff-session', 'player');
  });
});
