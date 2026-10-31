import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('Reclub Name availability endpoints', () => {
  let app: INestApplication;
  const service = {
    getReclubNameAvailability: jest.fn(),
    getMemberSession: jest.fn(),
  };
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    service.getReclubNameAvailability.mockResolvedValue({ available: true });
  });
  afterEach(async () => {
    await app.close();
    jest.resetAllMocks();
  });

  it('allows public registration availability checks without exposing owners', async () => {
    await request(app.getHttpServer<Server>())
      .get('/members/reclub-name-availability')
      .query({ name: 'PlayerOne', excludedMemberId: 'attacker' })
      .expect('Cache-Control', 'private, no-store')
      .expect(200, { available: true });
    expect(service.getReclubNameAvailability).toHaveBeenCalledWith('PlayerOne');
  });

  it('takes profile exclusions from the session, never client input', async () => {
    service.getMemberSession.mockResolvedValue({
      member: { memberId: 'self' },
    });
    await request(app.getHttpServer<Server>())
      .get('/members/me/reclub-name-availability')
      .set('Cookie', 'spaqueue_member_session=token')
      .query({ name: 'PlayerOne', excludedMemberId: 'other' })
      .expect('Cache-Control', 'private, no-store')
      .expect(200, { available: true });
    expect(service.getMemberSession).toHaveBeenCalledWith('token');
    expect(service.getReclubNameAvailability).toHaveBeenCalledWith(
      'PlayerOne',
      'self',
    );
  });

  it('requires authentication for profile checks', async () => {
    service.getMemberSession.mockRejectedValue(new UnauthorizedException());
    await request(app.getHttpServer<Server>())
      .get('/members/me/reclub-name-availability')
      .query({ name: 'PlayerOne' })
      .expect(401);
    expect(service.getReclubNameAvailability).not.toHaveBeenCalled();
  });
});
