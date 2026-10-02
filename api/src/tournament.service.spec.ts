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