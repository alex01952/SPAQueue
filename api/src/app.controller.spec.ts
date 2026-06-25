import { Test, TestingModule } from '@nestjs/testing';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Player } from './queue.types';
const testPlayers: Player[] = [
  {
    id: 1,
    name: 'AB',
    dupr: null,
    skillLevel: 'Beginner',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 2,
    name: 'Adam',
    dupr: 3.006,
    skillLevel: 'Intermediate',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 3,
    name: 'Akio',
    dupr: 3.5,
    skillLevel: 'High Intermediate',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 4,
    name: 'AL Deligro',
    dupr: 2.16,
    skillLevel: 'Beginner',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 5,
    name: 'Ann',
    dupr: 2.677,
    skillLevel: 'Novice',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 6,
    name: 'Annie',
    dupr: 2.926,
    skillLevel: 'Novice',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 7,
    name: 'Aya',
    dupr: 2.29,
    skillLevel: 'Beginner',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 8,
    name: 'Bea',
    dupr: 2.113,
    skillLevel: 'Beginner',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 9,
    name: 'Brian Gabriel',
    dupr: 3.583,
    skillLevel: 'High Intermediate',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 10,
    name: 'Bubs',
    dupr: 3.174,
    skillLevel: 'Intermediate',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 11,
    name: 'Daine',
    dupr: 3.286,
    skillLevel: 'Intermediate',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
  {
    id: 27,
    name: 'Louie',
    dupr: null,
    skillLevel: 'Beginner',
    isReady: false,
    checkedInAt: null,
    gender: null,
  },
];

describe('AppController', () => {
  let appController: AppController;
  let roundsFilePath: string;
  let participationRootPath: string;
  let duprCsvPath: string;
  let membershipCsvPath: string;
  let playersFilePath: string;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-24T09:00:00.000Z'));
    const tempDirectory = mkdtempSync(join(tmpdir(), 'pickleball-queue-'));
    roundsFilePath = join(tempDirectory, 'rounds.json');
    participationRootPath = join(tempDirectory, 'OPParticipation');
    duprCsvPath = join(tempDirectory, 'dupr-members.csv');
    membershipCsvPath = join(tempDirectory, 'club-membership.csv');
    playersFilePath = join(tempDirectory, 'players.json');
    mkdirSync(join(participationRootPath, 'June'), { recursive: true });
    writeFileSync(
      roundsFilePath,
      JSON.stringify(
        [
          {
            id: 1,
            roundNumber: 1,
            status: 'ongoing',
            createdAt: '2026-05-23T08:15:00.000Z',
            completedAt: null,
            games: [
              {
                id: 1,
                courtNumber: 1,
                status: 'ongoing',
                playerIds: [1, 2, 3, 5],
                createdAt: '2026-05-23T08:15:00.000Z',
                completedAt: null,
                score: null,
              },
            ],
          },
          {
            id: 2,
            roundNumber: 2,
            status: 'completed',
            createdAt: '2026-05-23T07:40:00.000Z',
            completedAt: '2026-05-23T08:05:00.000Z',
            games: [
              {
                id: 2,
                courtNumber: 2,
                status: 'completed',
                playerIds: [4, 6, 2, 3],
                createdAt: '2026-05-23T07:40:00.000Z',
                completedAt: '2026-05-23T08:05:00.000Z',
                score: { team1: 11, team2: 8 },
              },
            ],
          },
        ],
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(participationRootPath, 'June', '1_All.txt'),
      [
        'Open Play 5PM-9PM 150/head Courts 1,2 and 4',
        'Mon, Jun 1 @5:00 PM',
        'X2VC+XH Sorsogon City',
        '',
        ' (3) ',
        ' 1. Sorsogon Pickleball Arena',
        '2. Lex',
        '3. Net',
        '',
        'Participants (3)',
        '1. Shayee',
        '2. Louize',
        '3. Net',
        '',
        'Requested (2)',
        '1. Shayee',
        '2. Someone Else',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(participationRootPath, 'June', '2_All.txt'),
      ['Participants (2)', '1. Shayee', '2. Net'].join('\n'),
      'utf8',
    );
    writeFileSync(
      duprCsvPath,
      ['DUPR ID,doubles', 'dupr-1,3.78', 'dupr-2,4.12'].join('\n'),
      'utf8',
    );
    writeFileSync(
      membershipCsvPath,
      [
        'Reclub Name,Skill Level (Self Assesment),DUPR ID',
        'Alex,Intermediate,dupr-1',
        'Jordan,Advanced,dupr-2',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      playersFilePath,
      JSON.stringify(testPlayers, null, 2),
      'utf8',
    );
    process.env.MATCH_HISTORY_FILE_PATH = roundsFilePath;
    process.env.OP_PARTICIPATION_ROOT_PATH = participationRootPath;
    process.env.OP_PARTICIPATION_AZURE_PREFIX = '2026';
    process.env.DUPR_MEMBERS_LOCAL_FILE_PATH = duprCsvPath;
    process.env.CLUB_MEMBERSHIP_LOCAL_FILE_PATH = membershipCsvPath;
    process.env.PLAYER_LIST_FILE_PATH = playersFilePath;

    process.env.ARENA_MASTER_ELIGIBILITY_COUNT = '2';
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  afterEach(() => {
    delete process.env.MATCH_HISTORY_FILE_PATH;
    delete process.env.OP_PARTICIPATION_ROOT_PATH;
    delete process.env.OP_PARTICIPATION_AZURE_PREFIX;
    delete process.env.DUPR_MEMBERS_LOCAL_FILE_PATH;
    delete process.env.CLUB_MEMBERSHIP_LOCAL_FILE_PATH;
    delete process.env.PLAYER_LIST_FILE_PATH;
    delete process.env.ARENA_MASTER_ELIGIBILITY_COUNT;
    jest.useRealTimers();
  });

  it('should return API status from the root endpoint', () => {
    expect(appController.getHealthCheck()).toEqual({
      name: 'SPA Queue API',
      status: 'ok',
      endpoints: ['/queue', '/participation/monthly'],
    });
  });

  describe('monthly participation', () => {
    it('should count only players listed in the Participants section for each month', async () => {
      const summary = await appController.getMonthlyParticipationSummary();

      expect(summary).toEqual({
        arenaMasterEligibilityCount: 2,
        lastUpdatedAt: '2026-06-02T00:00:00.000Z',
        summaries: [
          {
            month: 'June',
            players: [
              { name: 'Net', count: 2 },
              { name: 'Shayee', count: 2 },
              { name: 'Louize', count: 1 },
            ],
          },
        ],
      });
    });
  });

  describe('participants import', () => {
    it('should import only names under Participants (#), map skill/DUPR, and reset rounds', async () => {
      const result = await appController.importParticipantsFromText(`
Open Play 5PM-9PM 150/head Courts 1,2 and 4
Mon, Jun 1 @5:00 PM

Participants (3)
1. Alex
2. Jordan
3. Morgan

Requested (2)
1. Ignore One
2. Ignore Two
`);

      const snapshot = appController.getQueueSnapshot(1);

      expect(result.importedPlayers).toBe(3);
      expect(snapshot.players.map((player) => player.name)).toEqual([
        'Alex',
        'Jordan',
        'Morgan',
      ]);
      expect(snapshot.players.map((player) => player.skillLevel)).toEqual([
        'Intermediate',
        'Advanced',
        'N/A',
      ]);
      expect(snapshot.players.map((player) => player.dupr)).toEqual([
        3.78,
        4.12,
        null,
      ]);
      expect(snapshot.players.every((player) => !player.isReady)).toBe(true);
      expect(snapshot.ongoingRounds).toEqual([]);
      expect(snapshot.recentRounds).toEqual([]);
      expect(snapshot.nextGame.eligiblePlayers).toEqual([]);
    });
  });

  describe('queue', () => {
    it('should create an empty players file when it does not exist yet', async () => {
      const tempDirectory = mkdtempSync(
        join(tmpdir(), 'pickleball-queue-empty-'),
      );
      const emptyPlayersFilePath = join(tempDirectory, 'players.json');

      process.env.PLAYER_LIST_FILE_PATH = emptyPlayersFilePath;

      const app: TestingModule = await Test.createTestingModule({
        controllers: [AppController],
        providers: [AppService],
      }).compile();

      app.get<AppController>(AppController);

      const savedPlayers = JSON.parse(
        readFileSync(emptyPlayersFilePath, 'utf8'),
      ) as Array<unknown>;

      expect(existsSync(emptyPlayersFilePath)).toBe(true);
      expect(savedPlayers).toEqual([]);
      process.env.PLAYER_LIST_FILE_PATH = playersFilePath;
    });
    it('should return queue snapshot data', () => {
      const snapshot = appController.getQueueSnapshot(3);

      expect(snapshot.players.length).toBeGreaterThan(0);
      expect(snapshot.ongoingRounds.length).toBe(1);
      expect(snapshot.nextGame.courtCount).toBe(3);
      expect(snapshot.nextGame.selectionMode).toBe('queue-line');
      expect(snapshot.nextGame.matchingMode).toBe('dupr-balance');
      expect(
        snapshot.nextGame.eligiblePlayers.every((player) => !player.isPlaying),
      ).toBe(true);
    });

    it('should move players who just finished a game to the back of the queue line', () => {
      appController.updatePlayerReadyState(1, true);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(2, true);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(3, true);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(5, true);
      jest.setSystemTime(new Date('2026-05-24T09:04:00.000Z'));
      appController.updatePlayerReadyState(9, true);
      jest.setSystemTime(new Date('2026-05-24T09:05:00.000Z'));
      appController.updatePlayerReadyState(10, true);
      jest.setSystemTime(new Date('2026-05-24T09:06:00.000Z'));
      appController.completeGame(1, { team1: 11, team2: 9 });

      const queueLineSnapshot = appController.getQueueSnapshot(1, 'queue-line');
      const checkInOrderSnapshot = appController.getQueueSnapshot(
        1,
        'check-in-order',
      );

      expect(
        queueLineSnapshot.nextGame.eligiblePlayers
          .slice(0, 2)
          .map((player) => player.id),
      ).toEqual([9, 10]);
      expect(
        checkInOrderSnapshot.nextGame.eligiblePlayers
          .slice(0, 2)
          .map((player) => player.id),
      ).toEqual([1, 2]);
      expect(
        queueLineSnapshot.nextGame.eligiblePlayers.find(
          (player) => player.id === 1,
        )?.queueEnteredAt,
      ).toBe('2026-05-24T09:06:00.000Z');
    });

    it('should prioritize players with the fewest recent completed games', () => {
      appController.updatePlayerReadyState(4, true);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(6, true);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(9, true);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(10, true);

      const leastPlayedSnapshot = appController.getQueueSnapshot(
        1,
        'least-played-first',
      );

      expect(leastPlayedSnapshot.nextGame.selectionMode).toBe(
        'least-played-first',
      );
      expect(
        leastPlayedSnapshot.nextGame.eligiblePlayers
          .slice(0, 4)
          .map((player) => player.id),
      ).toEqual([9, 10, 4, 6]);
      expect(
        leastPlayedSnapshot.nextGame.eligiblePlayers
          .slice(0, 4)
          .map((player) => player.recentGamesPlayed),
      ).toEqual([0, 0, 1, 1]);
    });

    it('should balance suggested teams by total DUPR rating', () => {
      appController.updatePlayerReadyState(4, true);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(6, true);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(9, true);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(10, true);

      const snapshot = appController.getQueueSnapshot(1, 'queue-line');
      const [firstCourt] = snapshot.nextGame.courts;

      expect(
        firstCourt.teams.map((team) => team.players.map((player) => player.id)),
      ).toEqual([
        [4, 9],
        [6, 10],
      ]);
    });

    it('should treat unrated players as 3.0 DUPR when balancing teams', () => {
      appController.updatePlayerReadyState(27, true);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(4, true);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(6, true);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(9, true);

      const snapshot = appController.getQueueSnapshot(1, 'queue-line');
      const [firstCourt] = snapshot.nextGame.courts;

      expect(
        firstCourt.teams.map((team) => team.players.map((player) => player.id)),
      ).toEqual([
        [27, 6],
        [4, 9],
      ]);
    });

    it('should split mixed skill levels evenly when using skill-balance matching', () => {
      appController.updatePlayerReadyState(4, true);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(8, true);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(10, true);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(11, true);

      const snapshot = appController.getQueueSnapshot(
        1,
        'least-played-first',
        'skill-balance',
      );
      const [firstCourt] = snapshot.nextGame.courts;
      const teamSignatures = firstCourt.teams
        .map((team) =>
          team.players
            .map((player) => player.id)
            .sort((left, right) => left - right)
            .join('-'),
        )
        .sort();

      expect(snapshot.nextGame.matchingMode).toBe('skill-balance');
      expect(teamSignatures).toEqual(['4-10', '8-11']);
    });
  });

  describe('complete game', () => {
    it('should create games on the selected court numbers', () => {
      appController.updatePlayerReadyState(4, true);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(6, true);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(9, true);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(10, true);

      const round = appController.createGames([
        {
          courtNumber: 7,
          playerIds: [4, 6, 9, 10],
        },
      ]);

      expect(round.games[0].courtNumber).toBe(7);
    });

    it('should record the match score', () => {
      const completedRound = appController.completeGame(1, {
        team1: 11,
        team2: 9,
      });
      const persistedRounds = JSON.parse(
        readFileSync(roundsFilePath, 'utf8'),
      ) as Array<{
        games: Array<{
          id: number;
          score: { team1: number; team2: number } | null;
        }>;
      }>;
      const persistedGame = persistedRounds
        .flatMap((round) => round.games)
        .find((game) => game.id === 1);

      expect(completedRound.status).toBe('completed');
      expect(persistedGame?.score).toEqual({ team1: 11, team2: 9 });
    });
  });
});
