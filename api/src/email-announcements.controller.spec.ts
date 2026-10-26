import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('Announcement HTTP endpoints', () => {
  let app: INestApplication;
  const service = {
    getAnnouncementRecipients: jest.fn().mockResolvedValue([]),
    previewAnnouncement: jest.fn().mockResolvedValue({ recipientCount: 50 }),
    sendAnnouncement: jest.fn().mockResolvedValue({ accepted: 50 }),
    getAnnouncementStatus: jest.fn().mockResolvedValue({ status: 'completed' }),
  };
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('forwards cookies and bodies and marks responses private and non-cacheable', async () => {
    const cookie = 'spaqueue_member_session=admin-token';
    const body = {
      subject: 'News',
      html: '<p>News</p>',
      audience: { mode: 'all' },
    };
    await request(app.getHttpServer<Server>())
      .get('/admin/email-announcements/recipients')
      .set('Cookie', cookie)
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(service.getAnnouncementRecipients).toHaveBeenCalledWith(
      'admin-token',
    );
    await request(app.getHttpServer<Server>())
      .post('/admin/email-announcements/preview')
      .set('Cookie', cookie)
      .send(body)
      .expect('Cache-Control', 'private, no-store')
      .expect(201);
    expect(service.previewAnnouncement).toHaveBeenCalledWith(
      'admin-token',
      body,
    );
    await request(app.getHttpServer<Server>())
      .post('/admin/email-announcements/send')
      .set('Cookie', cookie)
      .send(body)
      .expect('Cache-Control', 'private, no-store')
      .expect(201);
    expect(service.sendAnnouncement).toHaveBeenCalledWith('admin-token', body);
    await request(app.getHttpServer<Server>())
      .get('/admin/email-announcements/request-id')
      .set('Cookie', cookie)
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(service.getAnnouncementStatus).toHaveBeenCalledWith(
      'admin-token',
      'request-id',
    );
  });
});
