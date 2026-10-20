import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AppService } from './app.service';

const member = {
  memberId: 'member-1',
  name: 'Alex',
  role: 'member',
} as any;

const session = { authenticated: true, member } as any;

const notFound = () => {
  const error = new Error('Not found') as Error & { statusCode: number };
  error.statusCode = 404;
  return error;
};

describe('AppService club join requests', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(session);
    jest.spyOn(service as any, 'assertClubExists').mockResolvedValue(undefined);
  });

  it('creates a pending request for a valid club', async () => {
    const membershipClient = {
      getEntity: jest.fn().mockRejectedValue(notFound()),
    };
    const requestClient = {
      getEntity: jest.fn().mockRejectedValue(notFound()),
      upsertEntity: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(service as any, 'getClubMembersTableClient')
      .mockReturnValue(membershipClient);
    jest
      .spyOn(service as any, 'getClubJoinRequestsTableClient')
      .mockReturnValue(requestClient);

    const result = await service.requestToJoinClub('session-token', 'club-1');

    expect(result).toEqual(
      expect.objectContaining({
        clubId: 'club-1',
        memberId: 'member-1',
        status: 'Pending',
      }),
    );
    expect(requestClient.upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'club-1',
        rowKey: 'member-1',
        Status: 'Pending',
      }),
      'Replace',
    );
  });

  it('rejects a duplicate pending request', async () => {
    jest.spyOn(service as any, 'getClubMembersTableClient').mockReturnValue({
      getEntity: jest.fn().mockRejectedValue(notFound()),
    });
    jest
      .spyOn(service as any, 'getClubJoinRequestsTableClient')
      .mockReturnValue({
        getEntity: jest.fn().mockResolvedValue({ Status: 'Pending' }),
        upsertEntity: jest.fn(),
      });

    await expect(
      service.requestToJoinClub('session-token', 'club-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('approves a pending request and creates club membership', async () => {
    jest
      .spyOn(service as any, 'assertCanManageClub')
      .mockResolvedValue(undefined);
    const membershipClient = {
      upsertEntity: jest.fn().mockResolvedValue(undefined),
    };
    const requestClient = {
      getEntity: jest.fn().mockResolvedValue({
        MemberName: 'Jordan',
        Status: 'Pending',
        RequestedAt: '2026-09-27T10:00:00.000Z',
      }),
      updateEntity: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(service as any, 'getClubMembersTableClient')
      .mockReturnValue(membershipClient);
    jest
      .spyOn(service as any, 'getClubJoinRequestsTableClient')
      .mockReturnValue(requestClient);

    const result = await service.reviewClubJoinRequest(
      'session-token',
      'club-1',
      'member-2',
      'Approved',
    );

    expect(result).toEqual(
      expect.objectContaining({
        clubId: 'club-1',
        memberId: 'member-2',
        memberName: 'Jordan',
        status: 'Approved',
      }),
    );
    expect(membershipClient.upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'club-1',
        rowKey: 'member-2',
        Role: 'Member',
      }),
      'Merge',
    );
    expect(requestClient.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'club-1',
        rowKey: 'member-2',
        Status: 'Approved',
      }),
      'Merge',
    );
  });

  it('does not allow an unauthorized member to review requests', async () => {
    jest
      .spyOn(service as any, 'assertCanManageClub')
      .mockRejectedValue(
        new ForbiddenException('You are not authorized to manage this club.'),
      );

    await expect(
      service.getPendingClubJoinRequests('session-token', 'club-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a club officer to add a regular member', async () => {
    jest
      .spyOn(service as any, 'assertCanManageClub')
      .mockResolvedValue(undefined);
    const membershipClient = {
      upsertEntity: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(service as any, 'getClubMembersTableClient')
      .mockReturnValue(membershipClient);

    const result = await service.assignMemberToClub(
      'session-token',
      'club-1',
      'member-2',
    );

    expect(result).toEqual({
      clubId: 'club-1',
      memberId: 'member-2',
      role: 'Member',
    });
    expect(membershipClient.upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'club-1',
        rowKey: 'member-2',
        Role: 'Member',
      }),
      'Merge',
    );
  });

  it('does not allow a club officer to assign another officer', async () => {
    await expect(
      service.assignMemberToClub(
        'session-token',
        'club-1',
        'member-2',
        'Officer',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an administrator to create a club', async () => {
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue({
      authenticated: true,
      member: { ...member, memberId: 'admin-1', role: 'admin' },
    });
    const createEntity = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getClubsTableClient').mockReturnValue({
      createEntity,
    });

    const result = await service.createClub(
      'admin-session',
      '  Sorsogon City Pickleball  ',
    );

    expect(result).toEqual(
      expect.objectContaining({
        clubId: 'sorsogon-city-pickleball',
        name: 'Sorsogon City Pickleball',
      }),
    );
    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'clubs',
        rowKey: 'sorsogon-city-pickleball',
        CreatedBy: 'admin-1',
      }),
    );
  });

  it('does not allow a regular member to create a club', async () => {
    await expect(
      service.createClub('session-token', 'New Club'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an administrator to assign a club officer', async () => {
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue({
      authenticated: true,
      member: { ...member, role: 'admin' },
    });
    const membershipClient = {
      upsertEntity: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(service as any, 'getClubMembersTableClient')
      .mockReturnValue(membershipClient);

    await expect(
      service.assignMemberToClub(
        'admin-session',
        'club-1',
        'member-2',
        'Officer',
      ),
    ).resolves.toEqual({
      clubId: 'club-1',
      memberId: 'member-2',
      role: 'Officer',
    });
  });

  describe('AppService player profile validations', () => {
    let service: AppService;

    beforeEach(() => {
      service = new AppService();
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue({
        authenticated: true,
        member: {
          memberId: 'officer-1',
          name: 'Officer Alex',
          role: 'member',
        },
      });
      jest
        .spyOn(service as any, 'assertCanManageClub')
        .mockResolvedValue(undefined);
    });

    it('records an officer validation for a player in the same club', async () => {
      const upsertEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getClubMembersTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue({ Role: 'Member' }),
      });
      jest.spyOn(service as any, 'getClubsTableClient').mockReturnValue({
        listEntities: jest.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield {
              rowKey: 'sorsogon-pickleball',
              Name: 'Sorsogon Pickleball',
            };
          },
        }),
      });
      jest.spyOn(service as any, 'getPlayerReviewsTableClient').mockReturnValue({
        upsertEntity,
      });

      const result = await service.validateClubMemberProfile(
        'session-token',
        'sorsogon-pickleball',
        'player-1',
      );

      expect(result).toEqual(
        expect.objectContaining({
          officerName: 'Officer Alex',
          clubName: 'Sorsogon Pickleball',
        }),
      );
      expect(upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          partitionKey: 'sorsogon-pickleball',
          rowKey: 'player-1:officer-1',
          PlayerId: 'player-1',
          OfficerName: 'Officer Alex',
          ClubName: 'Sorsogon Pickleball',
        }),
        'Replace',
      );
    });

    it('does not allow an officer to validate their own profile', async () => {
      await expect(
        service.validateClubMemberProfile(
          'session-token',
          'sorsogon-pickleball',
          'officer-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns validations in newest-first order for a member profile', async () => {
      jest.spyOn(service as any, 'getPlayerReviewsTableClient').mockReturnValue({
        listEntities: jest.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield {
              OfficerName: 'Officer Earlier',
              ClubName: 'First Club',
              ValidatedAt: '2026-10-01T10:00:00.000Z',
            };
            yield {
              OfficerName: 'Officer Latest',
              ClubName: 'Second Club',
              ValidatedAt: '2026-10-02T10:00:00.000Z',
            };
          },
        }),
      });

      await expect(
        service.getMemberProfileValidations('session-token', 'player-1'),
      ).resolves.toEqual([
        {
          officerName: 'Officer Latest',
          clubName: 'Second Club',
          validatedAt: '2026-10-02T10:00:00.000Z',
        },
        {
          officerName: 'Officer Earlier',
          clubName: 'First Club',
          validatedAt: '2026-10-01T10:00:00.000Z',
        },
      ]);
    });

    it('shows a club officer only that club member validation list', async () => {
      jest.spyOn(service, 'getMemberDirectory').mockResolvedValue([
        {
          memberId: 'player-1',
          name: 'Player One',
          role: 'member',
          clubName: 'Sorsogon Pickleball',
          profileImageUrl: '',
        },
      ]);
      jest.spyOn(service as any, 'getPlayerReviewsTableClient').mockReturnValue({
        listEntities: jest.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield {
              PlayerId: 'player-1',
              OfficerName: 'Officer Alex',
              ClubName: 'Sorsogon Pickleball',
              ValidatedAt: '2026-10-02T10:00:00.000Z',
            };
          },
        }),
      });

      await expect(
        service.getClubMembersForProfileValidation(
          'session-token',
          'sorsogon-pickleball',
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          memberId: 'player-1',
          validations: [
            {
              officerName: 'Officer Alex',
              clubName: 'Sorsogon Pickleball',
              validatedAt: '2026-10-02T10:00:00.000Z',
            },
          ],
        }),
      ]);
    });
  });

  describe('AppService email verification resend', () => {
    let service: AppService;

    beforeEach(() => {
      service = new AppService();
    });

    it('invalidates prior verification tokens before sending a replacement link', async () => {
      const memberId = Buffer.from('pending@example.com').toString('base64url');
      const createEntity = jest.fn().mockResolvedValue(undefined);
      const deleteEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getMembersTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue({
          Name: 'Pending Member',
          Email: 'pending@example.com',
          EmailValidated: false,
          Status: 'Pending',
        }),
        listEntities: jest.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield { rowKey: 'old-token-hash' };
          },
        }),
        createEntity,
        deleteEntity,
      });
      jest
        .spyOn(service as any, 'sendVerificationEmail')
        .mockResolvedValue(undefined);

      await expect(
        service.resendEmailVerification(' pending@example.com '),
      ).resolves.toEqual({ sent: true, email: 'pe*****@example.com' });

      expect(deleteEntity).toHaveBeenCalledWith(
        'email-verifications',
        'old-token-hash',
      );
      expect(createEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          partitionKey: 'email-verifications',
          MemberId: memberId,
        }),
      );
    });

    it('does not resend a verification link after the email has been verified', async () => {
      jest.spyOn(service as any, 'getMembersTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue({
          EmailValidated: true,
          Status: 'Pending',
        }),
      });

      await expect(
        service.resendEmailVerification('verified@example.com'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
