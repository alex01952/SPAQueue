import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { AppService, MemberRegistrationInput } from './app.service';

describe('Reclub Name validation', () => {
  let service: AppService;
  let requestVerification: jest.SpyInstance;
  let members: Record<string, unknown>[];
  let table: {
    listEntities: jest.Mock;
    getEntity: jest.Mock;
    createEntity: jest.Mock;
    updateEntity: jest.Mock;
  };
  const input: MemberRegistrationInput = {
    name: 'Player',
    email: 'player@example.com',
    contactNo: '+639123456789',
    emergencyContact: '+639987654321',
    birthday: '1990-01-01',
    locationType: 'Other',
    location: 'Albay',
    gender: 'Female',
    password: 'strong-password',
    reClubId: 'PlayerOne',
    skills: {},
  };

  beforeEach(() => {
    service = new AppService();
    members = [{ rowKey: 'other', ReclubId: ' PlayerOne ', Status: 'Pending' }];
    table = {
      listEntities: jest.fn(() => ({
        [Symbol.asyncIterator]: () => {
          const iterator = members[Symbol.iterator]();
          return { next: () => Promise.resolve(iterator.next()) };
        },
      })),
      getEntity: jest.fn().mockResolvedValue({
        rowKey: 'self',
        Name: 'Player',
        ReclubId: 'Original',
        Email: 'player@example.com',
        Skills: '{}',
      }),
      createEntity: jest.fn().mockResolvedValue(undefined),
      updateEntity: jest.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(service, 'getMembersTableClient', {
      value: () => table,
    });
    requestVerification = jest
      .spyOn(service, 'requestEmailVerification')
      .mockResolvedValue({
        sent: true,
        email: 'player@example.com',
      });
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('finds trimmed names in any account status without returning member details', async () => {
    expect(await service.getReclubNameAvailability(' PlayerOne ')).toEqual({
      available: false,
    });
    expect(table.listEntities).toHaveBeenCalledWith({
      queryOptions: {
        filter: "PartitionKey eq 'members'",
        select: ['RowKey', 'ReclubId'],
      },
    });
  });

  it('keeps comparisons case-sensitive', async () => {
    expect(await service.getReclubNameAvailability('playerone')).toEqual({
      available: true,
    });
  });

  it('excludes only the current member, not other accounts with the same name', async () => {
    members = [{ rowKey: 'self', ReclubId: 'PlayerOne' }];
    expect(
      await service.getReclubNameAvailability('PlayerOne', 'self'),
    ).toEqual({ available: true });
    members.push({ rowKey: 'other', ReclubId: 'PlayerOne' });
    expect(
      await service.getReclubNameAvailability('PlayerOne', 'self'),
    ).toEqual({ available: false });
  });

  it('allows optional blank names without querying storage', async () => {
    expect(await service.getReclubNameAvailability('  ')).toEqual({
      available: true,
    });
    expect(table.listEntities).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 123, ['PlayerOne']])(
    'rejects invalid availability input %j',
    async (value) => {
      await expect(
        service.getReclubNameAvailability(value),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(table.listEntities).not.toHaveBeenCalled();
    },
  );

  it('fails explicitly when storage cannot be queried', async () => {
    table.listEntities.mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    await expect(
      service.getReclubNameAvailability('PlayerOne'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects duplicate registration before creating an account or sending verification', async () => {
    await expect(service.registerMember(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(table.createEntity).not.toHaveBeenCalled();
    expect(requestVerification).not.toHaveBeenCalled();
  });

  it('accepts a unique name and preserves the existing ReclubId entity property', async () => {
    members = [];
    await service.registerMember({ ...input, reClubId: ' UniquePlayer ' });
    expect(table.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ ReclubId: 'UniquePlayer' }),
    );
  });

  it('rejects duplicate profile updates before writing changes', async () => {
    await expect(
      service.updateMemberAccount('self', input),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(table.updateEntity).not.toHaveBeenCalled();
  });

  it('allows retaining your own name and saves using the existing property', async () => {
    members = [{ rowKey: 'self', ReclubId: 'PlayerOne' }];
    await service.updateMemberAccount('self', input);
    expect(table.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ rowKey: 'self', ReclubId: 'PlayerOne' }),
      'Merge',
    );
  });

  it('blocks registration and editing when duplicate checks fail', async () => {
    table.listEntities.mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    await expect(service.registerMember(input)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(
      service.updateMemberAccount('self', input),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(table.createEntity).not.toHaveBeenCalled();
    expect(table.updateEntity).not.toHaveBeenCalled();
  });
});
