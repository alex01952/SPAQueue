import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppService } from './app.service';

const tournament = {
  tournamentId: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Club Open',
  category: 'Mens Doubles' as const,
  level: 'Intermediate' as const,
  maxSlots: 8,
  date: '',
  location: '',
  registrationCount: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
};

const teamTournament = {
  ...tournament,
  category: 'Team Tournament' as const,
};

const memberSession = (memberId: string, gender = 'Male', role = 'member') => ({
  authenticated: true as const,
  member: {
    memberId,
    name: memberId,
    gender,
    role,
  } as any,
});

const experience = {
  hasJoinedTournaments: true,
  highestTournamentLevel: 'Low Intermediate' as const,
  hasWonTournaments: true,
  highestWinningLevel: 'Beginner' as const,
  winsOrPodiums: 2,
};

describe('AppService tournament registration', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
    jest.spyOn(service as any, 'getTournament').mockResolvedValue(tournament);
  });

  it('enforces category-specific doubles gender rules', () => {
    const isEligible = (category: string, first: string, second: string) =>
      (service as any).isTournamentGenderEligible(category, first, second);

    expect(isEligible('Mens Doubles', 'Male', 'Male')).toBe(true);
    expect(isEligible('Mens Doubles', 'Male', 'Female')).toBe(false);
    expect(isEligible('Womens Doubles', 'Female', 'Female')).toBe(true);
    expect(isEligible('Mixed Doubles', 'Male', 'Female')).toBe(true);
    expect(isEligible('Mixed Doubles', 'Female', 'Female')).toBe(false);
  });

  it('returns all name matches and marks ineligible members', async () => {
    const membersTable = {
      listEntities: jest.fn(() => ({
        async *[Symbol.asyncIterator]() {
          yield { rowKey: 'member-b', Name: 'Jane Player', Gender: 'Male' };
          yield { rowKey: 'member-c', Name: 'Alex Player', Gender: 'Male' };
          yield { rowKey: 'member-d', Name: 'Alexander', Gender: 'Female' };
        },
      })),
    };
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([]);
    jest.spyOn(service as any, 'getMembersTableClient').mockReturnValue(membersTable);

    const matches = await service.getEligibleTournamentPartners('session', tournament.tournamentId, 'jane');

    expect(matches).toEqual([{
      memberId: 'member-b',
      name: 'Jane Player',
      gender: 'Male',
      eligible: true,
    }]);
    await expect(
      service.getEligibleTournamentPartners('session', tournament.tournamentId, 'der'),
    ).resolves.toEqual([{
      memberId: 'member-d',
      name: 'Alexander',
      gender: 'Female',
      eligible: false,
      unavailableReason: "Does not meet this tournament category's gender requirements.",
    }]);
    expect(membersTable.listEntities).toHaveBeenCalledWith(expect.objectContaining({
      queryOptions: expect.objectContaining({ select: ['RowKey', 'Name', 'Gender'] }),
    }));
  });

  it('returns no partner matches for searches shorter than two characters', async () => {
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([]);

    await expect(
      service.getEligibleTournamentPartners('session', tournament.tournamentId, 'j'),
    ).resolves.toEqual([]);
  });

  it('excludes all players already committed to a team tournament roster', async () => {
    jest.spyOn(service as any, 'getTournament').mockResolvedValue(teamTournament);
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([{
      MemberId: 'captain',
      PartnerId: 'member-a',
      Status: 'Invitation Pending',
      TeamMembers: JSON.stringify([
        { memberId: 'captain', name: 'Captain', gender: 'Male', accepted: true },
        { memberId: 'member-a', name: 'Member A', gender: 'Male', accepted: false },
        { memberId: 'member-b', name: 'Member B', gender: 'Female', accepted: false },
        { memberId: 'member-c', name: 'Member C', gender: 'Female', accepted: false },
      ]),
    }]);
    jest.spyOn(service as any, 'getMembersTableClient').mockReturnValue({
      listEntities: jest.fn(() => ({
        async *[Symbol.asyncIterator]() {
          yield { rowKey: 'member-a', Name: 'Member A', Gender: 'Male' };
          yield { rowKey: 'member-b', Name: 'Member B', Gender: 'Female' };
          yield { rowKey: 'member-c', Name: 'Member C', Gender: 'Female' };
          yield { rowKey: 'free-member', Name: 'Free Member', Gender: 'Male' };
        },
      })),
    });

    await expect(
      service.getEligibleTournamentPartners('session', tournament.tournamentId, 'member'),
    ).resolves.toEqual([
      { memberId: 'free-member', name: 'Free Member', gender: 'Male', eligible: true },
      { memberId: 'member-a', name: 'Member A', gender: 'Male', eligible: false, unavailableReason: 'This is your account.' },
      { memberId: 'member-b', name: 'Member B', gender: 'Female', eligible: false, unavailableReason: 'Already registered or invited for this tournament.' },
      { memberId: 'member-c', name: 'Member C', gender: 'Female', eligible: false, unavailableReason: 'Already registered or invited for this tournament.' },
    ]);
  });

  it('marks an invitation as incoming for the invited member', async () => {
    const invitation = {
      rowKey: 'member-a',
      partitionKey: tournament.tournamentId,
      TournamentId: tournament.tournamentId,
      TournamentName: tournament.name,
      Category: tournament.category,
      Level: tournament.level,
      MemberId: 'member-a',
      MemberName: 'member-a',
      PartnerId: 'member-b',
      PartnerName: 'member-b',
      Status: 'Invitation Pending',
      RegisteredAt: '2026-10-01T00:00:00.000Z',
    };
    const table = {
      listEntities: jest.fn(() => ({
        async *[Symbol.asyncIterator]() { yield invitation; },
      })),
    };
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-b'));
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    const registrations = await service.getMyTournamentRegistrations('session');

    expect(registrations).toHaveLength(1);
    expect(registrations[0].isIncomingInvitation).toBe(true);
  });

  it('lists team invitations for teammates who are not the primary partner', async () => {
    const invitation = {
      rowKey: 'captain',
      partitionKey: teamTournament.tournamentId,
      TournamentId: teamTournament.tournamentId,
      TournamentName: teamTournament.name,
      Category: teamTournament.category,
      Level: teamTournament.level,
      MemberId: 'captain',
      MemberName: 'Captain',
      PartnerId: 'member-b',
      PartnerName: 'Member B',
      Status: 'Invitation Pending',
      RegisteredAt: '2026-10-01T00:00:00.000Z',
      TeamMembers: JSON.stringify([
        { memberId: 'captain', name: 'Captain', gender: 'Male', accepted: true, experience },
        { memberId: 'member-b', name: 'Member B', gender: 'Male', accepted: false },
        { memberId: 'member-c', name: 'Member C', gender: 'Female', accepted: false },
        { memberId: 'member-d', name: 'Member D', gender: 'Female', accepted: false },
      ]),
    };
    const table = {
      listEntities: jest.fn(() => ({
        async *[Symbol.asyncIterator]() { yield invitation; },
      })),
    };
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-d', 'Female'));
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    const registrations = await service.getMyTournamentRegistrations('session');

    expect(registrations).toHaveLength(1);
    expect(registrations[0].isIncomingInvitation).toBe(true);
    expect(registrations[0].teamMembers).toHaveLength(4);
  });

  it('creates an invitation for an eligible partner', async () => {
    const table = { createEntity: jest.fn().mockResolvedValue(undefined) };
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
    jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'member-b', gender: 'Male' });
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([]);
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    const registration = await service.registerTournamentTeam(
      'session',
      tournament.tournamentId,
      'member-b',
      experience,
    );

    expect(registration.status).toBe('Invitation Pending');
    expect(table.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: tournament.tournamentId,
        rowKey: 'member-a',
        PartnerId: 'member-b',
        Status: 'Invitation Pending',
      }),
    );
  });

  it('creates a Team Tournament invitation for three teammates with a 2-and-2 roster', async () => {
    const teamMembers = new Map([
      ['member-b', { name: 'Member B', gender: 'Male' }],
      ['member-c', { name: 'Member C', gender: 'Female' }],
      ['member-d', { name: 'Member D', gender: 'Female' }],
    ]);
    const table = { createEntity: jest.fn().mockResolvedValue(undefined) };
    jest.spyOn(service as any, 'getTournament').mockResolvedValue(teamTournament);
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a', 'Male'));
    jest.spyOn(service as any, 'getTournamentMember').mockImplementation(async (memberId: string) => teamMembers.get(memberId)!);
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([]);
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    const registration = await service.registerTournamentTeam(
      'session',
      teamTournament.tournamentId,
      'member-b',
      experience,
      ['member-b', 'member-c', 'member-d'],
    );

    expect(registration.status).toBe('Invitation Pending');
    expect(registration.teamMembers?.map((member) => [member.memberId, member.accepted])).toEqual([
      ['member-a', true],
      ['member-b', false],
      ['member-c', false],
      ['member-d', false],
    ]);
    expect(JSON.parse(table.createEntity.mock.calls[0][0].TeamMembers)).toHaveLength(4);
  });

  it('rejects a Team Tournament roster that is not two men and two women', async () => {
    const teamMembers = new Map([
      ['member-b', { name: 'Member B', gender: 'Male' }],
      ['member-c', { name: 'Member C', gender: 'Male' }],
      ['member-d', { name: 'Member D', gender: 'Female' }],
    ]);
    jest.spyOn(service as any, 'getTournament').mockResolvedValue(teamTournament);
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a', 'Male'));
    jest.spyOn(service as any, 'getTournamentMember').mockImplementation(async (memberId: string) => teamMembers.get(memberId)!);

    await expect(
      service.registerTournamentTeam(
        'session', teamTournament.tournamentId, 'member-b', experience,
        ['member-b', 'member-c', 'member-d'],
      ),
    ).rejects.toThrow('exactly two men and two women');
  });

  it('requires tournament experience answers before registering', async () => {
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));

    await expect(
      service.registerTournamentTeam('session', tournament.tournamentId, 'member-b', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects registering with a partner who does not meet category rules', async () => {
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
    jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'member-b', gender: 'Female' });

    await expect(
      service.registerTournamentTeam('session', tournament.tournamentId, 'member-b', experience),
    ).rejects.toThrow('gender requirements');
  });

  it('does not allow a member to join a second active team', async () => {
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
    jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'member-c', gender: 'Male' });
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([
      { MemberId: 'member-b', PartnerId: 'member-a', Status: 'Invitation Pending' },
    ]);

    await expect(
      service.registerTournamentTeam('session', tournament.tournamentId, 'member-c', experience),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('moves an accepted partner invitation to pending approval', async () => {
    const invitation = {
      partitionKey: tournament.tournamentId,
      rowKey: 'member-a',
      MemberId: 'member-a',
      MemberName: 'member-a',
      PartnerId: 'member-b',
      PartnerName: 'member-b',
      TournamentId: tournament.tournamentId,
      TournamentName: tournament.name,
      Category: tournament.category,
      Level: tournament.level,
      RegisteredAt: '2026-10-01T00:00:00.000Z',
      Status: 'Invitation Pending',
      MemberHasJoinedTournaments: true,
      MemberHighestTournamentLevel: 'Low Intermediate',
      MemberHasWonTournaments: true,
      MemberHighestWinningLevel: 'Beginner',
      MemberWinsOrPodiums: 2,
    };
    const table = {
      getEntity: jest.fn().mockResolvedValue(invitation),
      updateEntity: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-b'));
    jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'member-a', gender: 'Male' });
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([invitation]);
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    const result = await service.respondToTournamentInvitation(
      'session',
      tournament.tournamentId,
      'member-a',
      'Accepted',
      experience,
    );

    expect(result.status).toBe('Pending Approval');
    expect(table.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        Status: 'Pending Approval',
        PartnerAccepted: true,
        PartnerHighestWinningLevel: 'Beginner',
        PartnerWinsOrPodiums: 2,
      }),
      'Merge',
    );
  });

  it('requires all three Team Tournament invitees to accept before admin review', async () => {
    let currentMemberId = 'member-b';
    let invitation: Record<string, unknown> = {
      partitionKey: teamTournament.tournamentId,
      rowKey: 'member-a',
      MemberId: 'member-a',
      MemberName: 'member-a',
      PartnerId: 'member-b',
      PartnerName: 'member-b',
      TournamentId: teamTournament.tournamentId,
      TournamentName: teamTournament.name,
      Category: teamTournament.category,
      Level: teamTournament.level,
      RegisteredAt: '2026-10-01T00:00:00.000Z',
      Status: 'Invitation Pending',
      PartnerAccepted: false,
      TeamMembers: JSON.stringify([
        { memberId: 'member-a', name: 'member-a', gender: 'Male', accepted: true, experience },
        { memberId: 'member-b', name: 'member-b', gender: 'Male', accepted: false },
        { memberId: 'member-c', name: 'member-c', gender: 'Female', accepted: false },
        { memberId: 'member-d', name: 'member-d', gender: 'Female', accepted: false },
      ]),
    };
    const table = {
      getEntity: jest.fn(async () => invitation),
      updateEntity: jest.fn(async (update: Record<string, unknown>) => {
        invitation = { ...invitation, ...update };
      }),
    };
    jest.spyOn(service as any, 'getTournament').mockResolvedValue(teamTournament);
    jest.spyOn(service as any, 'getMemberSession').mockImplementation(async () =>
      memberSession(currentMemberId, currentMemberId === 'member-b' ? 'Male' : 'Female'),
    );
    jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'member-a', gender: 'Male' });
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockImplementation(async () => [invitation]);
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    for (const [memberId, expectedStatus] of [
      ['member-b', 'Invitation Pending'],
      ['member-c', 'Invitation Pending'],
      ['member-d', 'Pending Approval'],
    ] as const) {
      currentMemberId = memberId;
      const result = await service.respondToTournamentInvitation(
        'session', teamTournament.tournamentId, 'member-a', 'Accepted', experience,
      );
      expect(result.status).toBe(expectedStatus);
      expect(result.teamMembers?.find((member) => member.memberId === memberId)).toMatchObject({
        accepted: true,
        experience,
      });
    }
    expect(JSON.parse(String(invitation.TeamMembers)).every((member: { accepted: boolean }) => member.accepted)).toBe(true);
  });

  it('requires the invited partner tournament experience before accepting', async () => {
    const table = {
      getEntity: jest.fn().mockResolvedValue({
        PartnerId: 'member-b',
        Status: 'Invitation Pending',
      }),
    };
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-b'));
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    await expect(
      service.respondToTournamentInvitation('session', tournament.tournamentId, 'member-a', 'Accepted'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not let an unrelated member respond to an invitation', async () => {
    const table = {
      getEntity: jest.fn().mockResolvedValue({
        PartnerId: 'member-b',
        Status: 'Invitation Pending',
      }),
    };
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-c'));
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    await expect(
      service.respondToTournamentInvitation('session', tournament.tournamentId, 'member-a', 'Accepted'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not approve a Team Tournament until every teammate has accepted', async () => {
    const table = {
      getEntity: jest.fn().mockResolvedValue({
        rowKey: 'member-a',
        partitionKey: teamTournament.tournamentId,
        MemberId: 'member-a',
        PartnerId: 'member-b',
        Category: teamTournament.category,
        Level: teamTournament.level,
        Status: 'Pending Approval',
        PartnerAccepted: true,
        TeamMembers: JSON.stringify([
          { memberId: 'member-a', name: 'A', gender: 'Male', accepted: true },
          { memberId: 'member-b', name: 'B', gender: 'Male', accepted: true },
          { memberId: 'member-c', name: 'C', gender: 'Female', accepted: false },
          { memberId: 'member-d', name: 'D', gender: 'Female', accepted: true },
        ]),
      }),
      updateEntity: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    await expect(
      service.approveTournamentRegistration('session', teamTournament.tournamentId, 'member-a'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(table.updateEntity).not.toHaveBeenCalled();
  });

  it('requires an approved registration before accepting payment proof', async () => {
    const table = {
      getEntity: jest.fn().mockResolvedValue({
        MemberId: 'member-a',
        PartnerId: 'member-b',
        Status: 'Pending Approval',
      }),
    };
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-b'));
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    await expect(
      service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', {
        originalname: 'receipt.pdf',
        buffer: Buffer.from('receipt'),
        mimetype: 'application/pdf',
        size: 7,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});