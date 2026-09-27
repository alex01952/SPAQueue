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
    const membershipClient = { getEntity: jest.fn().mockRejectedValue(notFound()) };
    const requestClient = {
      getEntity: jest.fn().mockRejectedValue(notFound()),
      upsertEntity: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(service as any, 'getClubMembersTableClient').mockReturnValue(membershipClient);
    jest.spyOn(service as any, 'getClubJoinRequestsTableClient').mockReturnValue(requestClient);

    const result = await service.requestToJoinClub('session-token', 'club-1');

    expect(result).toEqual(expect.objectContaining({
      clubId: 'club-1',
      memberId: 'member-1',
      status: 'Pending',
    }));
    expect(requestClient.upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({ partitionKey: 'club-1', rowKey: 'member-1', Status: 'Pending' }),
      'Replace',
    );
  });

  it('rejects a duplicate pending request', async () => {
    jest.spyOn(service as any, 'getClubMembersTableClient').mockReturnValue({
      getEntity: jest.fn().mockRejectedValue(notFound()),
    });
    jest.spyOn(service as any, 'getClubJoinRequestsTableClient').mockReturnValue({
      getEntity: jest.fn().mockResolvedValue({ Status: 'Pending' }),
      upsertEntity: jest.fn(),
    });

    await expect(service.requestToJoinClub('session-token', 'club-1'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('approves a pending request and creates club membership', async () => {
    jest.spyOn(service as any, 'assertCanManageClub').mockResolvedValue(undefined);
    const membershipClient = { upsertEntity: jest.fn().mockResolvedValue(undefined) };
    const requestClient = {
      getEntity: jest.fn().mockResolvedValue({
        MemberName: 'Jordan',
        Status: 'Pending',
        RequestedAt: '2026-09-27T10:00:00.000Z',
      }),
      updateEntity: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(service as any, 'getClubMembersTableClient').mockReturnValue(membershipClient);
    jest.spyOn(service as any, 'getClubJoinRequestsTableClient').mockReturnValue(requestClient);

    const result = await service.reviewClubJoinRequest(
      'session-token',
      'club-1',
      'member-2',
      'Approved',
    );

    expect(result).toEqual(expect.objectContaining({
      clubId: 'club-1',
      memberId: 'member-2',
      memberName: 'Jordan',
      status: 'Approved',
    }));
    expect(membershipClient.upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({ partitionKey: 'club-1', rowKey: 'member-2', Role: 'Member' }),
      'Merge',
    );
    expect(requestClient.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ partitionKey: 'club-1', rowKey: 'member-2', Status: 'Approved' }),
      'Merge',
    );
  });

  it('does not allow an unauthorized member to review requests', async () => {
    jest.spyOn(service as any, 'assertCanManageClub').mockRejectedValue(
      new ForbiddenException('You are not authorized to manage this club.'),
    );

    await expect(service.getPendingClubJoinRequests('session-token', 'club-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a club officer to add a regular member', async () => {
    jest.spyOn(service as any, 'assertCanManageClub').mockResolvedValue(undefined);
    const membershipClient = { upsertEntity: jest.fn().mockResolvedValue(undefined) };
    jest.spyOn(service as any, 'getClubMembersTableClient').mockReturnValue(membershipClient);

    const result = await service.assignMemberToClub(
      'session-token',
      'club-1',
      'member-2',
    );

    expect(result).toEqual({ clubId: 'club-1', memberId: 'member-2', role: 'Member' });
    expect(membershipClient.upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({ partitionKey: 'club-1', rowKey: 'member-2', Role: 'Member' }),
      'Merge',
    );
  });

  it('does not allow a club officer to assign another officer', async () => {
    await expect(service.assignMemberToClub(
      'session-token',
      'club-1',
      'member-2',
      'Officer',
    )).rejects.toBeInstanceOf(ForbiddenException);
  });
});
