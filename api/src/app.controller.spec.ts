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

const dashboardPassword = 'test-dashboard-password';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;
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
    process.env.DASHBOARD_PASSWORD = dashboardPassword;
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  afterEach(() => {
    delete process.env.MATCH_HISTORY_FILE_PATH;
    delete process.env.OP_PARTICIPATION_ROOT_PATH;
    delete process.env.OP_PARTICIPATION_AZURE_PREFIX;
    delete process.env.DUPR_MEMBERS_LOCAL_FILE_PATH;
    delete process.env.CLUB_MEMBERSHIP_LOCAL_FILE_PATH;
    delete process.env.PLAYER_LIST_FILE_PATH;
    delete process.env.ARENA_MASTER_ELIGIBILITY_COUNT;
    delete process.env.DASHBOARD_PASSWORD;
    jest.useRealTimers();
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

  describe('member registration', () => {
    it('should store the uploaded profile URL and a verifiable password hash', async () => {
      const createEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(appService as any, 'getMembersTableClient').mockReturnValue({
        createEntity,
      });
      jest
        .spyOn(appService as any, 'uploadMemberProfileImage')
        .mockResolvedValue(
          'https://seeturtlesphsa.blob.core.windows.net/spa/member-profile-images/member/photo.jpg',
        );

      await appController.registerMember(
        {
          name: 'Alex Member',
          email: 'alex@example.com',
          contactNo: '09123456789',
          emergencyContact: 'Emergency Contact',
          age: 30,
          gender: 'Female',
          password: 'strong-password',
          skills: {},
        },
        {
          originalname: 'photo.jpg',
          buffer: Buffer.from('image'),
          mimetype: 'image/jpeg',
          size: 5,
        },
      );

      const entity = createEntity.mock.calls[0][0];
      expect(entity.ProfileImageUrl).toBe(
        'https://seeturtlesphsa.blob.core.windows.net/spa/member-profile-images/member/photo.jpg',
      );
      expect(entity.Password).toBeUndefined();
      expect(entity.PasswordHash).toMatch(/^scrypt\$/);
      await expect(
        appService.verifyPassword('strong-password', entity.PasswordHash),
      ).resolves.toBe(true);
      await expect(
        appService.verifyPassword('wrong-password', entity.PasswordHash),
      ).resolves.toBe(false);
    });

    it('should report Azure Table authorization failures returned in response headers', async () => {
      jest.spyOn(appService as any, 'getMembersTableClient').mockReturnValue({
        createEntity: jest.fn().mockRejectedValue({
          statusCode: 403,
          response: {
            headers: {
              get: (name: string) =>
                name === 'x-ms-error-code'
                  ? 'AuthorizationPermissionMismatch'
                  : undefined,
            },
          },
        }),
      });

      await expect(
        appController.registerMember({
          name: 'Alex Member',
          email: 'alex@example.com',
          contactNo: '09123456789',
          emergencyContact: 'Emergency Contact',
          age: 30,
          gender: 'Female',
          password: 'strong-password',
          skills: {},
        }),
      ).rejects.toThrow(
        'Grant the API managed identity the Storage Table Data Contributor role',
      );
    });
  });

  describe('member authentication', () => {
    it('should create and resolve a hashed server-side member session', async () => {
      const passwordHash = await (appService as any).hashPassword(
        'strong-password',
      );
      const memberEntity = {
        partitionKey: 'members',
        rowKey: Buffer.from('alex@example.com').toString('base64url'),
        Name: 'Alex Member',
        Email: 'alex@example.com',
        ContactNo: '09123456789',
        EmergencyContact: 'Emergency Contact',
        Age: 30,
        Gender: 'Female',
        DUPRId: 'DUPR-123',
        ReclubId: 'RECLUB-456',
        ProfileImageUrl: 'https://example.com/alex.jpg',
        Skills: JSON.stringify({ serve: 8, dink: 7 }),
        CreatedAt: '2026-04-12T08:00:00.000Z',
        PasswordHash: passwordHash,
      };
      let sessionEntity: Record<string, unknown> | undefined;
      jest.spyOn(appService as any, 'getMembersTableClient').mockReturnValue({
        getEntity: jest.fn((partitionKey: string) => {
          if (partitionKey === 'members') {
            return Promise.resolve(memberEntity);
          }

          return Promise.resolve(sessionEntity);
        }),
        createEntity: jest.fn((entity: Record<string, unknown>) => {
          sessionEntity = entity;
          return Promise.resolve();
        }),
      });
      const response = { cookie: jest.fn() } as any;

      const login = await appController.loginMember(
        'Alex@Example.com',
        'strong-password',
        response,
      );

      const [cookieName, sessionToken, cookieOptions] =
        response.cookie.mock.calls[0];
      expect(login.member).toMatchObject({
        name: 'Alex Member',
        age: 30,
        gender: 'Female',
        duprId: 'DUPR-123',
        reClubId: 'RECLUB-456',
        skills: { serve: 8, dink: 7 },
        createdAt: '2026-04-12T08:00:00.000Z',
      });
      expect(login.member).not.toHaveProperty('email');
      expect(login.member).not.toHaveProperty('contactNo');
      expect(login.member).not.toHaveProperty('emergencyContact');
      expect(login.member).not.toHaveProperty('PasswordHash');
      expect(cookieName).toBe('spaqueue_member_session');
      expect(cookieOptions).toMatchObject({ httpOnly: true, sameSite: 'lax' });
      expect(sessionEntity?.partitionKey).toBe('sessions');
      expect(sessionEntity?.rowKey).not.toBe(sessionToken);
      expect(String(sessionEntity?.rowKey)).toHaveLength(64);

      await expect(
        appController.getMemberSession(
          `other=value; ${cookieName}=${sessionToken}`,
        ),
      ).resolves.toEqual({ authenticated: true, member: login.member });
    });

    it('should reject an invalid password without revealing account details', async () => {
      const passwordHash = await (appService as any).hashPassword(
        'strong-password',
      );
      jest.spyOn(appService as any, 'getMembersTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue({ PasswordHash: passwordHash }),
      });

      await expect(
        appService.loginMember('alex@example.com', 'wrong-password'),
      ).rejects.toThrow('Invalid email or password.');
    });

    it('should return only public member directory fields in name order', async () => {
      jest.spyOn(appService, 'getMemberSession').mockResolvedValue({
        authenticated: true,
        member: {
          memberId: 'current-member',
          name: 'Current Member',
          age: 30,
          gender: 'Female',
          duprId: '',
          reClubId: '',
          profileImageUrl: '',
          skills: {},
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
      jest.spyOn(appService as any, 'getMembersTableClient').mockReturnValue({
        listEntities: jest.fn().mockReturnValue(
          (async function* () {
            yield {
              rowKey: 'zoe-member',
              Name: 'Zoe Member',
              Email: 'zoe@example.com',
              ContactNo: '09123456789',
              PasswordHash: 'secret',
              ProfileImageUrl: 'https://example.com/zoe.webp',
            };
            yield {
              rowKey: 'alex-member',
              Name: 'Alex Member',
              Role: 'Arena Master',
              ProfileImageUrl: '',
            };
          })(),
        ),
      });

      const directory = await appController.getMemberDirectory(
        'spaqueue_member_session=session-token',
      );

      expect(directory).toEqual([
        {
          memberId: 'alex-member',
          name: 'Alex Member',
          role: 'Arena Master',
          clubName: 'Sorsogon Pickleball Club',
          profileImageUrl: '',
        },
        {
          memberId: 'zoe-member',
          name: 'Zoe Member',
          role: 'Club Member',
          clubName: 'Sorsogon Pickleball Club',
          profileImageUrl: 'https://example.com/zoe.webp',
        },
      ]);
      expect(directory[1]).not.toHaveProperty('Email');
      expect(directory[1]).not.toHaveProperty('ContactNo');
      expect(directory[1]).not.toHaveProperty('PasswordHash');
      expect(appService.getMemberSession).toHaveBeenCalledWith('session-token');
    });

    it('should load the requested member profile by Table row key', async () => {
      jest.spyOn(appService, 'getMemberSession').mockResolvedValue({
        authenticated: true,
        member: {
          memberId: 'current-member',
          name: 'Current Member',
          age: 30,
          gender: 'Female',
          duprId: '',
          reClubId: '',
          profileImageUrl: '',
          skills: {},
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
      jest.spyOn(appService as any, 'getMembersTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue({
          Name: 'Selected Member',
          Age: 28,
          Gender: 'Male',
          DUPRId: 'DUPR-789',
          ReclubId: 'RECLUB-321',
          ProfileImageUrl: 'https://example.com/selected.webp',
          Skills: JSON.stringify({ serve: 8 }),
          CreatedAt: '2026-02-18T09:30:00.000Z',
          Email: 'private@example.com',
          PasswordHash: 'secret',
        }),
      });

      const profile = await appController.getMemberProfile(
        'selected-member-row-key',
        'spaqueue_member_session=session-token',
      );

      expect(profile).toEqual({
        memberId: 'selected-member-row-key',
        name: 'Selected Member',
        age: 28,
        gender: 'Male',
        duprId: 'DUPR-789',
        reClubId: 'RECLUB-321',
        profileImageUrl: 'https://example.com/selected.webp',
        skills: { serve: 8 },
        createdAt: '2026-02-18T09:30:00.000Z',
        emailValidated: false,
      });
      expect(profile.memberId).not.toBe('current-member');
      expect(profile).not.toHaveProperty('Email');
      expect(profile).not.toHaveProperty('PasswordHash');
      expect(appService.getMemberSession).toHaveBeenCalledWith('session-token');
    });

    it('should update the session member without allowing email changes', async () => {
      jest.spyOn(appService, 'getMemberSession').mockResolvedValue({
        authenticated: true,
        member: {
          memberId: 'current-member',
          name: 'Current Member',
          age: 30,
          gender: 'Female',
          duprId: '',
          reClubId: '',
          profileImageUrl: '',
          skills: {},
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
      const updateEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(appService as any, 'getMembersTableClient').mockReturnValue({
        updateEntity,
        getEntity: jest.fn().mockResolvedValue({
          Name: 'Updated Member',
          Email: 'original@example.com',
          ContactNo: '09999999999',
          EmergencyContact: 'Updated Contact',
          Age: 31,
          Gender: 'Female',
          DUPRId: 'DUPR-UPDATED',
          ReclubId: 'RECLUB-UPDATED',
          ProfileImageUrl: '',
          Skills: JSON.stringify({ serve: 9 }),
          CreatedAt: '2026-01-01T00:00:00.000Z',
          PasswordHash: 'unchanged-secret',
        }),
      });

      const updated = await appController.updateMyMemberAccount(
        {
          email: 'attacker@example.com',
          name: 'Updated Member',
          contactNo: '09999999999',
          emergencyContact: 'Updated Contact',
          age: 31,
          gender: 'Female',
          duprId: 'DUPR-UPDATED',
          reClubId: 'RECLUB-UPDATED',
          skills: { serve: 9 },
        },
        undefined,
        'spaqueue_member_session=session-token',
      );

      const entity = updateEntity.mock.calls[0][0];
      expect(entity.partitionKey).toBe('members');
      expect(entity.rowKey).toBe('current-member');
      expect(entity.Name).toBe('Updated Member');
      expect(entity).not.toHaveProperty('Email');
      expect(entity).not.toHaveProperty('PasswordHash');
      expect(updateEntity.mock.calls[0][1]).toBe('Merge');
      expect(updated.email).toBe('original@example.com');
      expect(updated.name).toBe('Updated Member');
      expect(updated.skills).toEqual({ serve: 9 });
    });

    it('should email a raw verification token while storing only its hash', async () => {
      const createEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(appService as any, 'getMembersTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue({
          Name: 'Alex Member',
          Email: 'alex@example.com',
          EmailValidated: false,
        }),
        createEntity,
        deleteEntity: jest.fn().mockResolvedValue(undefined),
      });
      const sendVerificationEmail = jest
        .spyOn(appService as any, 'sendVerificationEmail')
        .mockResolvedValue(undefined);

      const result = await appService.requestEmailVerification('alex-member');

      const verification = createEntity.mock.calls[0][0];
      const verificationUrl = sendVerificationEmail.mock.calls[0][2] as string;
      const token = new URL(verificationUrl).searchParams.get('token') ?? '';
      expect(result).toEqual({ sent: true, email: 'al**@example.com' });
      expect(verification.partitionKey).toBe('email-verifications');
      expect(verification.MemberId).toBe('alex-member');
      expect(verification.rowKey).not.toBe(token);
      expect(verification.rowKey).toHaveLength(64);
      expect(verificationUrl).toContain('/verify-email?token=');
      expect(sendVerificationEmail).toHaveBeenCalledWith(
        'alex@example.com',
        'Alex Member',
        expect.any(String),
      );
    });

    it('should validate the linked member and consume the verification token', async () => {
      const token = 'a'.repeat(43);
      const updateEntity = jest.fn().mockResolvedValue(undefined);
      const deleteEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(appService as any, 'getMembersTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue({
          MemberId: 'alex-member',
          ExpiresAt: '2026-05-24T10:00:00.000Z',
        }),
        updateEntity,
        deleteEntity,
      });

      await expect(appService.confirmEmailVerification(token)).resolves.toEqual({
        verified: true,
      });

      expect(updateEntity.mock.calls[0][0]).toMatchObject({
        partitionKey: 'members',
        rowKey: 'alex-member',
        EmailValidated: true,
      });
      expect(updateEntity.mock.calls[0][1]).toBe('Merge');
      expect(deleteEntity).toHaveBeenCalledWith(
        'email-verifications',
        expect.any(String),
      );
    });
  });

  describe('participants import', () => {
    it('should reject dashboard actions with the wrong password', () => {
      expect(() =>
        appController.getQueueSnapshot(1, undefined, undefined, 'wrong'),
      ).toThrow('Invalid dashboard password.');
    });

    it('should import only names under Participants (#), map skill/DUPR, and reset rounds', async () => {
      const result = await appController.importParticipantsFromText(
        `
Open Play 5PM-9PM 150/head Courts 1,2 and 4
Mon, Jun 1 @5:00 PM

Participants (3)
1. Alex
2. Jordan
3. Morgan

Requested (2)
1. Ignore One
2. Ignore Two
`,
        dashboardPassword,
      );

      const snapshot = appController.getQueueSnapshot(
        1,
        undefined,
        undefined,
        dashboardPassword,
      );

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
      const snapshot = appController.getQueueSnapshot(
        3,
        undefined,
        undefined,
        dashboardPassword,
      );

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
      appController.updatePlayerReadyState(1, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(2, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(3, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(5, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:04:00.000Z'));
      appController.updatePlayerReadyState(9, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:05:00.000Z'));
      appController.updatePlayerReadyState(10, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:06:00.000Z'));
      appController.completeGame(1, { team1: 11, team2: 9 }, dashboardPassword);

      const queueLineSnapshot = appController.getQueueSnapshot(
        1,
        'queue-line',
        undefined,
        dashboardPassword,
      );
      const checkInOrderSnapshot = appController.getQueueSnapshot(
        1,
        'check-in-order',
        undefined,
        dashboardPassword,
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
      appController.updatePlayerReadyState(4, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(6, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(9, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(10, true, dashboardPassword);

      const leastPlayedSnapshot = appController.getQueueSnapshot(
        1,
        'least-played-first',
        undefined,
        dashboardPassword,
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
      appController.updatePlayerReadyState(4, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(6, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(9, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(10, true, dashboardPassword);

      const snapshot = appController.getQueueSnapshot(
        1,
        'queue-line',
        undefined,
        dashboardPassword,
      );
      const [firstCourt] = snapshot.nextGame.courts;

      expect(
        firstCourt.teams.map((team) => team.players.map((player) => player.id)),
      ).toEqual([
        [4, 9],
        [6, 10],
      ]);
    });

    it('should treat unrated players as 3.0 DUPR when balancing teams', () => {
      appController.updatePlayerReadyState(27, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(4, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(6, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(9, true, dashboardPassword);

      const snapshot = appController.getQueueSnapshot(
        1,
        'queue-line',
        undefined,
        dashboardPassword,
      );
      const [firstCourt] = snapshot.nextGame.courts;

      expect(
        firstCourt.teams.map((team) => team.players.map((player) => player.id)),
      ).toEqual([
        [27, 6],
        [4, 9],
      ]);
    });

    it('should split mixed skill levels evenly when using skill-balance matching', () => {
      appController.updatePlayerReadyState(4, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(8, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(10, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(11, true, dashboardPassword);

      const snapshot = appController.getQueueSnapshot(
        1,
        'least-played-first',
        'skill-balance',
        dashboardPassword,
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
      appController.updatePlayerReadyState(4, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:01:00.000Z'));
      appController.updatePlayerReadyState(6, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:02:00.000Z'));
      appController.updatePlayerReadyState(9, true, dashboardPassword);
      jest.setSystemTime(new Date('2026-05-24T09:03:00.000Z'));
      appController.updatePlayerReadyState(10, true, dashboardPassword);

      const round = appController.createGames(
        [
          {
            courtNumber: 7,
            playerIds: [4, 6, 9, 10],
          },
        ],
        undefined,
        dashboardPassword,
      );

      expect(round.games[0].courtNumber).toBe(7);
    });

    it('should record the match score', () => {
      const completedRound = appController.completeGame(
        1,
        {
          team1: 11,
          team2: 9,
        },
        dashboardPassword,
      );
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
