import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AppService, MemberRole } from './app.service';

describe('Member contact search', () => {
  let service: AppService;
  let role: MemberRole;
  const rows = [
    { rowKey: 'one', Name: 'Alice Smith', ReclubId: 'Ace', ProfileImageUrl: 'image', ContactNo: '0123', Email: 'alice@example.com', EmergencyContact: '0456', Status: 'Approved', EmailValidated: true },
    { rowKey: 'two', Name: 'Bob Jones', ReclubId: 'Alice Player', Status: 'Approved', EmailValidated: true },
    { rowKey: 'pending', Name: 'Alice Pending', Status: 'Pending', EmailValidated: true },
    { rowKey: 'unverified', Name: 'Alice Unverified', Status: 'Approved', EmailValidated: false },
  ];
  const listEntities = jest.fn(() => rows);

  beforeEach(() => {
    role = 'admin';
    listEntities.mockClear();
    service = new AppService();
    Object.defineProperty(service, 'getMembersTableClient', { value: () => ({ listEntities }) });
    jest.spyOn(service, 'getMemberSession').mockImplementation((token) => {
      if (!token) throw new UnauthorizedException();
      return Promise.resolve({
        authenticated: true,
        member: { memberId: 'admin', name: 'Admin', role, age: null, gender: '', duprId: '', reClubId: '', profileImageUrl: '', skills: {}, createdAt: '', emailValidated: true },
      });
    });
  });

  it('searches names and Reclub names case-insensitively and returns only approved verified members', async () => {
    expect(await service.searchMemberContacts('session', ' ALICE ')).toEqual([
      { memberId: 'one', name: 'Alice Smith', reClubId: 'Ace', profileImageUrl: 'image', contactNo: '0123', email: 'alice@example.com', emergencyContact: '0456' },
      { memberId: 'two', name: 'Bob Jones', reClubId: 'Alice Player', profileImageUrl: '', contactNo: '', email: '', emergencyContact: '' },
    ]);
    expect(await service.searchMemberContacts('session', 'ace')).toHaveLength(1);
    expect(await service.searchMemberContacts('session', 'missing')).toEqual([]);
  });

  it.each<MemberRole>(['member', 'club-owner', 'balance-staff'])('denies %s before reading contacts', async (denied) => {
    role = denied;
    await expect(service.searchMemberContacts('session', 'alice')).rejects.toBeInstanceOf(ForbiddenException);
    expect(listEntities).not.toHaveBeenCalled();
  });

  it('requires a session and a nonempty search', async () => {
    await expect(service.searchMemberContacts('', 'alice')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.searchMemberContacts('session', '  ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.searchMemberContacts('session', ['alice', 'bob'])).rejects.toBeInstanceOf(BadRequestException);
    expect(listEntities).not.toHaveBeenCalled();
  });
});
