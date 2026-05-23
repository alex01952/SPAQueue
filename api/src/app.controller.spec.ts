import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('queue', () => {
    it('should return queue snapshot data', () => {
      const snapshot = appController.getQueueSnapshot(3);

      expect(snapshot.players.length).toBeGreaterThan(0);
      expect(snapshot.ongoingGames.length).toBe(1);
      expect(snapshot.nextGame.courtCount).toBe(3);
      expect(snapshot.nextGame.eligiblePlayers.every((player) => !player.isPlaying)).toBe(
        true,
      );
    });
  });

  describe('complete game', () => {
    it('should record the match score', () => {
      const completedGame = appController.completeGame(1, { team1: 11, team2: 9 });

      expect(completedGame.status).toBe('completed');
      expect(completedGame.score).toEqual({ team1: 11, team2: 9 });
    });
  });
});
