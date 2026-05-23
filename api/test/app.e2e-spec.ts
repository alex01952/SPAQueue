import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/queue?courtCount=3 (GET)', () => {
    return request(app.getHttpServer())
      .get('/queue?courtCount=3')
      .expect(200)
      .expect((response) => {
        expect(response.body.players.length).toBeGreaterThan(0);
        expect(response.body.ongoingGames.length).toBe(1);
        expect(response.body.nextGame.courtCount).toBe(3);
      });
  });

  it('/games/:id/complete (PATCH)', () => {
    return request(app.getHttpServer())
      .patch('/games/1/complete')
      .send({ team1: 11, team2: 7 })
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('completed');
        expect(response.body.score).toEqual({ team1: 11, team2: 7 });
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
