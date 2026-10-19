import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { corsOptions, isAllowedCorsOrigin } from './cors.config';

describe('CORS origin policy', () => {
  it('should allow local development origins on different ports', () => {
    expect(isAllowedCorsOrigin('http://localhost:4200', new Set())).toBe(true);
    expect(isAllowedCorsOrigin('http://127.0.0.1:4200', new Set())).toBe(true);
    expect(isAllowedCorsOrigin('https://localhost:4300', new Set())).toBe(true);
  });

  describe('Tournament cancellation over CORS', () => {
    let app: INestApplication<App>;
    const cancelTournamentRegistration = jest.fn();
    const path = '/tournaments/event-1/registrations/member-a';
    const origin = 'http://localhost:4200';

    beforeEach(async () => {
      cancelTournamentRegistration.mockReset().mockResolvedValue({ deleted: true });
      const module = await Test.createTestingModule({
        controllers: [AppController],
        providers: [{ provide: AppService, useValue: { cancelTournamentRegistration } }],
      }).compile();
      app = module.createNestApplication();
      app.enableCors(corsOptions);
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('permits a credentialed DELETE preflight with a normal 204 response', async () => {
      const response = await request(app.getHttpServer())
        .options(path)
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'DELETE')
        .expect(204)
        .expect('Access-Control-Allow-Origin', origin)
        .expect('Access-Control-Allow-Credentials', 'true');

      expect(response.headers['access-control-allow-methods'].split(',')).toContain('DELETE');
      expect(cancelTournamentRegistration).not.toHaveBeenCalled();
    });

    it('returns cancellation success to the allowed origin', async () => {
      await request(app.getHttpServer())
        .delete(path)
        .set('Origin', origin)
        .set('Cookie', 'spaqueue_member_session=session-token')
        .expect(200)
        .expect('Access-Control-Allow-Origin', origin)
        .expect({ deleted: true });

      expect(cancelTournamentRegistration).toHaveBeenCalledWith('session-token', 'event-1', 'member-a');
    });

    it('preserves useful API error messages for the browser', async () => {
      cancelTournamentRegistration.mockRejectedValue(new ConflictException('Only unpaid registrations can be cancelled.'));
      const response = await request(app.getHttpServer())
        .delete(path)
        .set('Origin', origin)
        .expect(409)
        .expect('Access-Control-Allow-Origin', origin);

      expect(response.body.message).toBe('Only unpaid registrations can be cancelled.');
    });
  });

  it('should allow configured deployed origins and reject unknown origins', () => {
    const configuredOrigins = new Set(['https://spa.example.com']);

    expect(
      isAllowedCorsOrigin('https://spa.example.com', configuredOrigins),
    ).toBe(true);
    expect(
      isAllowedCorsOrigin('https://unexpected.example.com', configuredOrigins),
    ).toBe(false);
  });

  it('should allow requests without an Origin header', () => {
    expect(isAllowedCorsOrigin(undefined, new Set())).toBe(true);
  });
});