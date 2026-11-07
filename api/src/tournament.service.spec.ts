import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppService, TOURNAMENT_TSHIRT_SIZES } from './app.service';

const tournament = {
  tournamentId: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Club Open',
  category: 'Mens Doubles' as const,
  level: 'Intermediate' as const,
  maxSlots: 8,
  date: '',
  location: '',
  registrationCount: 0,
  pendingRegistrationCount: 0,
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
const idBuffer = Buffer.from('%PDF-1.7\nPlayer ID');
const idFile = { originalname: 'id.pdf', mimetype: 'application/pdf', buffer: idBuffer, size: idBuffer.length };

describe('AppService tournament registration', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
    jest.spyOn(service as any, 'getTournament').mockResolvedValue(tournament);
    jest.spyOn(service as any, 'getTournamentDocumentBlobClient').mockReturnValue({});
    jest.spyOn(service as any, 'getTournamentIdContainerClient').mockReturnValue({
      getProperties: jest.fn().mockResolvedValue({}),
      getBlockBlobClient: jest.fn().mockReturnValue({}),
    });
    jest.spyOn(service as any, 'uploadParticipationBlob').mockResolvedValue(undefined);
  });

  describe('editing tournament details', () => {
    const input = { name: 'Updated Open', level: 'Advanced' as const, maxSlots: 3, date: '2027-01-05', location: 'Club courts', version: 'v1' };
    let table: { getEntity: jest.Mock; updateEntity: jest.Mock };
    beforeEach(() => {
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      table = { getEntity: jest.fn().mockResolvedValue({ rowKey: tournament.tournamentId, Name: tournament.name, Category: tournament.category, Level: tournament.level, MaxSlots: 8, etag: 'v1' }), updateEntity: jest.fn().mockResolvedValue({ etag: 'v2' }) };
      jest.spyOn(service as any, 'getTournamentsTableClient').mockReturnValue(table);
      jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([{ Status: 'Approved' }, { Status: 'Pending Approval' }]);
    });

    it('updates details without changing category and preserves registration counts', async () => {
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, input)).resolves.toMatchObject({ ...input, version: 'v2', category: tournament.category, registrationCount: 1, pendingRegistrationCount: 1 });
      expect(table.updateEntity).toHaveBeenCalledWith(expect.objectContaining({ Name: input.name, Level: input.level, MaxSlots: 3 }), 'Merge', { etag: 'v1' });
      expect(table.updateEntity.mock.calls[0][0]).not.toHaveProperty('Category');
    });

    it('returns the tournament version in the list and accepts it when saving', async () => {
      const entity = await table.getEntity();
      const tournamentsTable = { ...table, listEntities: jest.fn(() => (async function* () { yield entity; })()) };
      service['getTournamentsTableClient'] = jest.fn().mockReturnValue(tournamentsTable);
      service['getTournamentRegistrationsTableClient'] = jest.fn().mockReturnValue({ listEntities: jest.fn(() => (async function* () {})()) });
      const [listed] = await service.getTournaments('session');
      expect(listed.version).toBe('v1');
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, { ...input, version: listed.version })).resolves.toMatchObject({ name: input.name, version: 'v2' });
    });

    it('rejects category changes, too few slots, and conflicting updates', async () => {
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, { ...input, category: 'Mixed Doubles' })).rejects.toThrow('category cannot be changed');
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, { ...input, maxSlots: 0 })).rejects.toThrow('Maximum slots');
      service['getTournamentRegistrationEntities'] = jest.fn().mockResolvedValue([{ Status: 'Approved' }, { Status: 'Paid' }]);
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, { ...input, maxSlots: 1 })).rejects.toThrow('approved teams');
      table.updateEntity.mockRejectedValue({ statusCode: 412 });
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, input)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects non-admin users before touching tournament data', async () => {
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member'));
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, input)).rejects.toBeInstanceOf(ForbiddenException);
      expect(table.getEntity).not.toHaveBeenCalled();
    });

    it('rejects stale drafts and edits to events being archived', async () => {
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, { ...input, version: 'old' })).rejects.toThrow('changed');
      table.getEntity.mockResolvedValueOnce({ LifecycleState: 'Archiving' });
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, input)).rejects.toThrow('archived or deleted');
      expect(table.updateEntity).not.toHaveBeenCalled();
    });

    it('only changes terms while registration is closed and no registrations exist', async () => {
      const buffer = Buffer.from('%PDF-1.7');
      const file = { originalname: 'new.pdf', mimetype: 'application/pdf', size: buffer.length, buffer };
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, input, file)).rejects.toThrow('prior agreements');
      service['getTournamentRegistrationEntities'] = jest.fn().mockResolvedValue([]);
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, input, file)).rejects.toThrow('Close registration');
      table.getEntity.mockResolvedValue({ rowKey: tournament.tournamentId, Name: tournament.name, Category: tournament.category, Level: tournament.level, MaxSlots: 8, etag: 'v1', RegistrationClosed: true, TermsBlobName: 'old', TermsFileName: 'old.pdf' });
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, input, { ...file, buffer: Buffer.from('not pdf'), size: 7 })).rejects.toThrow('must be a PDF');
      await expect(service.updateTournamentDetails('session', tournament.tournamentId, input, file)).resolves.toMatchObject({ termsFileName: 'new.pdf', termsUrl: expect.stringContaining('/terms') });
      expect(table.updateEntity).toHaveBeenLastCalledWith(expect.objectContaining({ TermsBlobName: expect.stringContaining('tournament-terms/'), TermsFileName: 'new.pdf' }), 'Merge', { etag: 'v1' });
      const removed = await service.updateTournamentDetails('session', tournament.tournamentId, { ...input, removeTerms: true });
      expect(removed.termsUrl).toBeUndefined();
      expect(table.updateEntity).toHaveBeenLastCalledWith(expect.objectContaining({ TermsBlobName: '', TermsFileName: '' }), 'Merge', { etag: 'v1' });
    });
  });

  describe('tournament approval emails', () => {
    const savedEnv = { ...process.env };
    let updateEntity: jest.Mock;
    let blob: { getProperties: jest.Mock; downloadToBuffer: jest.Mock };
    let send: jest.SpyInstance;
    let registration: Record<string, unknown>;
    beforeEach(() => {
      process.env.MAILGUN_API_KEY = 'test-key';
      process.env.MAILGUN_DOMAIN = 'example.com';
      process.env.EMAIL_FROM = 'club@example.com';
      registration = { rowKey: 'member-a', partitionKey: tournament.tournamentId, MemberId: 'member-a', PartnerId: 'member-b', Category: tournament.category, Level: tournament.level, Status: 'Pending Approval', PartnerAccepted: true, etag: 'v1' };
      updateEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([]);
      jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue({ getEntity: jest.fn(async () => registration), updateEntity });
      jest.spyOn(service as any, 'getMembersTableClient').mockReturnValue({ getEntity: jest.fn(async (_partition: string, id: string) => ({ Name: id === 'member-a' ? '<Alice>' : id, Email: `${id}@example.com` })) });
      blob = { getProperties: jest.fn().mockResolvedValue({ contentLength: 100, etag: 'template-v1', metadata: { subject: 'Approved' } }), downloadToBuffer: jest.fn().mockResolvedValue(Buffer.from('<p>Hello {{memberName}}, {{tournamentName}}.</p><p>Pay via club staff. {{tournamentsUrl}}</p>')) };
      jest.spyOn(service as any, 'getEmailTemplateContainerClient').mockReturnValue({ getBlockBlobClient: jest.fn((name: string) => { expect(name).toBe('email-templates/tournament-approval.html'); return blob; }) });
      send = jest.spyOn(service as any, 'sendEmail').mockResolvedValue(undefined);
      jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    });
    afterEach(() => { process.env = { ...savedEnv }; });

    it('sends individually rendered payment instructions after approving', async () => {
      const result = await service.approveTournamentRegistration('session', tournament.tournamentId, 'member-a');
      expect(result).toMatchObject({ status: 'Approved', approvalEmailFailedRecipients: [] });
      expect(updateEntity).toHaveBeenCalledWith(expect.objectContaining({ Status: 'Approved' }), 'Merge', { etag: 'v1' });
      expect(send.mock.calls.map((call) => call[0])).toEqual(['member-a@example.com', 'member-b@example.com']);
      expect(send.mock.calls[0][2]).toContain('Pay via club staff');
      expect(send.mock.calls[0][3]).toContain('&lt;Alice&gt;');
      expect(send.mock.calls[0][3]).toContain('Club Open');
      expect(blob.downloadToBuffer).toHaveBeenCalledWith(0, 100, expect.objectContaining({ conditions: { ifMatch: 'template-v1' } }));
      expect(updateEntity.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    });

    it('notifies all four team members', async () => {
      registration.TeamMembers = JSON.stringify(['a', 'b', 'c', 'd'].map((memberId) => ({ memberId, name: memberId, gender: 'Male', accepted: true })));
      await service.approveTournamentRegistration('session', tournament.tournamentId, 'member-a');
      expect(send.mock.calls.map((call) => call[0])).toEqual(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']);
    });

    it('does not approve when the template or a participant email is unavailable', async () => {
      blob.getProperties.mockRejectedValueOnce({ statusCode: 404 });
      await expect(service.approveTournamentRegistration('session', tournament.tournamentId, 'member-a')).rejects.toThrow('email template was not found');
      service['getMembersTableClient'] = jest.fn().mockReturnValue({ getEntity: jest.fn().mockResolvedValue({ Email: '' }) });
      await expect(service.approveTournamentRegistration('session', tournament.tournamentId, 'member-a')).rejects.toThrow('no valid email address');
      expect(updateEntity).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('rejects unknown placeholders and concurrent approval without sending', async () => {
      blob.downloadToBuffer.mockResolvedValueOnce(Buffer.from('<p>{{unknown}}</p>'));
      await expect(service.approveTournamentRegistration('session', tournament.tournamentId, 'member-a')).rejects.toThrow('Unsupported tournament approval template placeholder');
      updateEntity.mockRejectedValueOnce({ statusCode: 412 });
      await expect(service.approveTournamentRegistration('session', tournament.tournamentId, 'member-a')).rejects.toBeInstanceOf(ConflictException);
      expect(send).not.toHaveBeenCalled();
    });

    it('reports unconfirmed delivery without undoing approval', async () => {
      send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('delivery uncertain'));
      await expect(service.approveTournamentRegistration('session', tournament.tournamentId, 'member-a'))
        .resolves.toMatchObject({ status: 'Approved', approvalEmailFailedRecipients: ['member-b@example.com'] });
    });
  });

  describe('admin declining registrations', () => {
    let deleteEntity: jest.Mock;
    let send: jest.SpyInstance;
    const savedEnv = { ...process.env };
    beforeEach(() => {
      process.env.MAILGUN_API_KEY = 'test-key';
      process.env.MAILGUN_DOMAIN = 'example.com';
      process.env.EMAIL_FROM = 'club@example.com';
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      jest.spyOn(service as any, 'getTournamentRegistrationEntity').mockResolvedValue({ MemberId: 'member-a', PartnerId: 'member-b', Status: 'Pending Approval', etag: 'v1' });
      deleteEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue({ deleteEntity });
      jest.spyOn(service as any, 'getMembersTableClient').mockReturnValue({ getEntity: jest.fn(async (_partition: string, id: string) => ({ Name: id, Email: `${id}@example.com` })) });
      send = jest.spyOn(service as any, 'sendEmail').mockResolvedValue(undefined);
    });
    afterEach(() => { process.env = { ...savedEnv }; });

    it('deletes the pending registration and emails each player the escaped reason', async () => {
      await expect(service.declineTournamentRegistration('session', tournament.tournamentId, 'member-a', '  Missing <proof>  '))
        .resolves.toEqual({ deleted: true, failedRecipients: [] });
      expect(deleteEntity).toHaveBeenCalledWith(tournament.tournamentId, 'member-a', { etag: 'v1' });
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][0]).toBe('member-a@example.com');
      expect(send.mock.calls[1][0]).toBe('member-b@example.com');
      expect(send.mock.calls[0][2]).toContain('Missing <proof>');
      expect(send.mock.calls[0][3]).toContain('Missing &lt;proof&gt;');
    });

    it('reports failed deliveries after the registration is removed', async () => {
      send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('delivery failed'));
      jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
      await expect(service.declineTournamentRegistration('session', tournament.tournamentId, 'member-a', 'Reason'))
        .resolves.toEqual({ deleted: true, failedRecipients: ['member-b@example.com'] });
    });

    it.each(['Invitation Pending', 'Pending Approval', 'Approved', 'Payment Submitted'])('declines unpaid registrations in %s state', async (status) => {
      service['getTournamentRegistrationEntity'] = jest.fn().mockResolvedValue({ MemberId: 'member-a', PartnerId: 'member-b', Status: status, etag: 'v1' });
      await expect(service.declineTournamentRegistration('session', tournament.tournamentId, 'member-a', 'Reason')).resolves.toMatchObject({ deleted: true });
    });

    it.each(['Paid', 'Invitation Declined'])('does not decline %s registrations', async (status) => {
      service['getTournamentRegistrationEntity'] = jest.fn().mockResolvedValue({ MemberId: 'member-a', PartnerId: 'member-b', Status: status, etag: 'v1' });
      await expect(service.declineTournamentRegistration('session', tournament.tournamentId, 'member-a', 'Reason')).rejects.toBeInstanceOf(ConflictException);
      expect(deleteEntity).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('sends an individual email to every member of a four-player team', async () => {
      service['getTournamentRegistrationEntity'] = jest.fn().mockResolvedValue({
        Status: 'Pending Approval', etag: 'v1', TeamMembers: JSON.stringify(['a', 'b', 'c', 'd'].map((memberId) => ({ memberId, name: memberId, gender: 'Male', accepted: true }))),
      });
      await service.declineTournamentRegistration('session', tournament.tournamentId, 'a', 'Eligibility reason');
      expect(send.mock.calls.map((call) => call[0])).toEqual(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']);
    });

    it('does not remove a registration when email is unconfigured or a recipient is missing', async () => {
      delete process.env.MAILGUN_API_KEY;
      await expect(service.declineTournamentRegistration('session', tournament.tournamentId, 'member-a', 'Reason')).rejects.toThrow('Email delivery is not configured');
      process.env.MAILGUN_API_KEY = 'test-key';
      service['getMembersTableClient'] = jest.fn().mockReturnValue({ getEntity: jest.fn().mockResolvedValue({ Name: 'Member', Email: '' }) });
      await expect(service.declineTournamentRegistration('session', tournament.tournamentId, 'member-a', 'Reason')).rejects.toThrow('no valid email address');
      expect(deleteEntity).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('does not remove registrations for invalid input, unauthorized admins, or concurrency conflicts', async () => {
      await expect(service.declineTournamentRegistration('session', tournament.tournamentId, 'member-a', ' ')).rejects.toThrow('decline reason');
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValueOnce(memberSession('member'));
      await expect(service.declineTournamentRegistration('session', tournament.tournamentId, 'member-a', 'Reason')).rejects.toBeInstanceOf(ForbiddenException);
      deleteEntity.mockRejectedValueOnce({ statusCode: 412 });
      await expect(service.declineTournamentRegistration('session', tournament.tournamentId, 'member-a', 'Reason')).rejects.toBeInstanceOf(ConflictException);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('player eligibility verification', () => {
    const clubDetails = 'City Club\nOfficer: Jane Doe\nContact: jane@example.com';
    let entity: Record<string, unknown>;
    let table: {
      createEntity: jest.Mock;
      updateEntity: jest.Mock;
      getEntity: jest.Mock;
      listEntities: jest.Mock;
    };

    beforeEach(() => {
      entity = {
        partitionKey: tournament.tournamentId, rowKey: 'captain', TournamentId: tournament.tournamentId,
        Category: 'Mens Doubles', Level: 'Intermediate', MemberId: 'captain', MemberName: 'Captain',
        PartnerId: 'partner', PartnerName: 'Partner', Status: 'Invitation Pending', etag: 'v1',
      };
      table = {
        createEntity: jest.fn(async (created: Record<string, unknown>) => { entity = created; }),
        updateEntity: jest.fn(async (updated: Record<string, unknown>) => { entity = { ...entity, ...updated }; }),
        getEntity: jest.fn(async () => entity),
        listEntities: jest.fn(() => (async function* () { yield entity; })()),
      };
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('captain'));
      jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'Partner', gender: 'Male' });
      jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([]);
      jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);
      jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    });

    it('uses the separate spaprivate container by default and rejects a shared container', () => {
      const actual = new AppService() as any;
      actual.azureStorageAccount = 'examplestorage';
      actual.azureContainerName = 'spa';
      actual.tournamentIdContainerName = 'spaprivate';
      expect(actual.getTournamentIdContainerClient().containerName).toBe('spaprivate');
      actual.tournamentIdContainerName = 'spa';
      expect(() => actual.getTournamentIdContainerClient()).toThrow('separate private tournament ID container');
    });

    it('requires an ID when registering and accepting, but not when declining', async () => {
      await expect(service.registerTournamentTeam('session', tournament.tournamentId, 'partner', experience))
        .rejects.toThrow('Upload your school, government, or company ID');
      expect(table.createEntity).not.toHaveBeenCalled();
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('partner'));
      await expect(service.respondToTournamentInvitation('session', tournament.tournamentId, 'captain', 'Accepted', experience))
        .rejects.toThrow('Upload your school, government, or company ID');
      expect(table.updateEntity).not.toHaveBeenCalled();
      await expect(service.respondToTournamentInvitation('session', tournament.tournamentId, 'captain', 'Declined'))
        .resolves.toMatchObject({ status: 'Invitation Declined' });
    });

    it.each([undefined, '', 'XXS', 'XXXL', '4XL', 42, null, {}])('rejects missing or unavailable player sizes: %p', async (size) => {
      service['getTournament'] = jest.fn().mockResolvedValue({ ...tournament, tshirtSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] });
      await expect(service.registerTournamentTeam(
        'session', tournament.tournamentId, 'partner', experience, undefined, undefined, idFile, undefined, size,
      )).rejects.toThrow('Select an available T-shirt size');
      service['getMemberSession'] = jest.fn().mockResolvedValue(memberSession('partner'));
      await expect(service.respondToTournamentInvitation(
        'session', tournament.tournamentId, 'captain', 'Accepted', experience, undefined, idFile, undefined, size,
      )).rejects.toThrow('Select an available T-shirt size');
      expect(table.createEntity).not.toHaveBeenCalled();
      expect(table.updateEntity).not.toHaveBeenCalled();
      expect(service['uploadParticipationBlob']).not.toHaveBeenCalled();
    });

    it.each(TOURNAMENT_TSHIRT_SIZES)('persists and returns each supported doubles size: %s', async (size) => {
      service['getTournament'] = jest.fn().mockResolvedValue({ ...tournament, tshirtSizes: [...TOURNAMENT_TSHIRT_SIZES] });
      const created = await service.registerTournamentTeam(
        'session', tournament.tournamentId, 'partner', experience, undefined, undefined, idFile, undefined, size,
      );
      expect(created.memberTshirtSize).toBe(size);
      expect(entity.MemberTshirtSize).toBe(size);
      service['getMemberSession'] = jest.fn().mockResolvedValue(memberSession('partner'));
      const accepted = await service.respondToTournamentInvitation(
        'session', tournament.tournamentId, 'captain', 'Accepted', experience, undefined, idFile, undefined, 'M',
      );
      expect(accepted).toMatchObject({ memberTshirtSize: size, partnerTshirtSize: 'M', status: 'Pending Approval' });
      expect((await service.getMyTournamentRegistrations('session'))[0]).toMatchObject({
        memberTshirtSize: size, partnerTshirtSize: 'M',
      });
    });

    it('saves a separate size for every team member without overwriting earlier players', async () => {
      service['getTournament'] = jest.fn().mockResolvedValue({ ...teamTournament, tshirtSizes: ['2XS', 'M', 'XL', '3XL'] });
      service['getTournamentMember'] = jest.fn(async (id) => ({
        name: id, gender: ['third', 'fourth'].includes(id) ? 'Female' : 'Male',
      }));
      const created = await service.registerTournamentTeam(
        'session', tournament.tournamentId, 'partner', experience, ['partner', 'third', 'fourth'],
        undefined, idFile, undefined, '2XS',
      );
      expect(created.teamMembers?.[0].tshirtSize).toBe('2XS');
      for (const [memberId, gender, size] of [
        ['partner', 'Male', 'M'], ['third', 'Female', 'XL'], ['fourth', 'Female', '3XL'],
      ]) {
        service['getMemberSession'] = jest.fn().mockResolvedValue(memberSession(memberId, gender));
        await service.respondToTournamentInvitation(
          'session', tournament.tournamentId, 'captain', 'Accepted', experience, undefined, idFile, undefined, size,
        );
      }
      const saved = (await service.getMyTournamentRegistrations('session'))[0];
      expect(saved.teamMembers?.map((player) => player.tshirtSize)).toEqual(['2XS', 'M', 'XL', '3XL']);
      expect(saved.status).toBe('Pending Approval');
    });

    it('does not require a size to decline even when T-shirts are configured', async () => {
      service['getTournament'] = jest.fn().mockResolvedValue({ ...tournament, tshirtSizes: ['M'] });
      service['getMemberSession'] = jest.fn().mockResolvedValue(memberSession('partner'));
      await expect(service.respondToTournamentInvitation('session', tournament.tournamentId, 'captain', 'Declined'))
        .resolves.toMatchObject({ status: 'Invitation Declined' });
    });

    it('persists a separate ID and optional club details for each player without exposing them to teammates', async () => {
      const created = await service.registerTournamentTeam(
        'session', tournament.tournamentId, 'partner', experience, undefined, undefined, idFile, clubDetails,
      );
      expect(created.eligibilityDetails).toBeUndefined();
      expect(JSON.parse(String(entity.EligibilityDetails))[0]).toMatchObject({
        memberId: 'captain', fileName: 'id.pdf', clubDetails,
        storage: 'private',
        blobName: expect.stringContaining(`tournament-player-ids/${tournament.tournamentId}/captain/`),
      });
      expect(service['getTournamentIdContainerClient']().getBlockBlobClient).toHaveBeenCalledWith(
        expect.stringContaining(`tournament-player-ids/${tournament.tournamentId}/captain/`),
      );
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('partner'));
      const accepted = await service.respondToTournamentInvitation(
        'session', tournament.tournamentId, 'captain', 'Accepted', experience, undefined, idFile,
      );
      expect(accepted.eligibilityDetails).toBeUndefined();
      expect(JSON.parse(String(entity.EligibilityDetails))).toHaveLength(2);
      expect((await service.getMyTournamentRegistrations('session'))[0].eligibilityDetails).toBeUndefined();
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      const reviewed = (await service.getTournamentRegistrationsForAdmin('session'))[0];
      expect(reviewed.eligibilityDetails).toEqual([
        expect.objectContaining({ memberId: 'captain', clubDetails, url: expect.stringContaining('/admin/tournaments/') }),
        expect.objectContaining({ memberId: 'partner', clubDetails: '' }),
      ]);
      expect(JSON.stringify(reviewed)).not.toContain('blobName');
      expect(JSON.stringify(reviewed)).not.toContain('"storage"');
    });

    it.each([
      { ...idFile, mimetype: 'text/html' },
      { ...idFile, buffer: Buffer.from('not a PDF'), size: 9 },
      { ...idFile, size: 0 },
      { ...idFile, size: 10 * 1024 * 1024 + 1 },
    ])('rejects invalid IDs before upload or registration writes', async (file) => {
      await expect(service.registerTournamentTeam(
        'session', tournament.tournamentId, 'partner', experience, undefined, undefined, file,
      )).rejects.toThrow('Player ID must be');
      expect(service['uploadParticipationBlob']).not.toHaveBeenCalled();
      expect(table.createEntity).not.toHaveBeenCalled();
    });

    it.each([
      { ...idFile, buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), size: 4, mimetype: 'image/jpeg' },
      { ...idFile, buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), size: 8, mimetype: 'image/png' },
      { ...idFile, buffer: Buffer.concat([idBuffer, Buffer.alloc(10 * 1024 * 1024 - idBuffer.length)]), size: 10 * 1024 * 1024 },
    ])('accepts supported images and a PDF at exactly the size limit', async (file) => {
      await expect(service.registerTournamentTeam(
        'session', tournament.tournamentId, 'partner', experience, undefined, undefined, file,
      )).resolves.toMatchObject({ status: 'Invitation Pending' });
    });

    it.each([42, 'x'.repeat(4001)])('rejects invalid club details without uploading', async (details) => {
      await expect(service.registerTournamentTeam(
        'session', tournament.tournamentId, 'partner', experience, undefined, undefined, idFile, details,
      )).rejects.toThrow('Club verification details');
      expect(service['uploadParticipationBlob']).not.toHaveBeenCalled();
    });

    it('does not register or accept when ID storage fails', async () => {
      jest.spyOn(service as any, 'uploadParticipationBlob').mockRejectedValue(new Error('Storage unavailable'));
      await expect(service.registerTournamentTeam(
        'session', tournament.tournamentId, 'partner', experience, undefined, undefined, idFile,
      )).rejects.toThrow();
      expect(table.createEntity).not.toHaveBeenCalled();
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('partner'));
      await expect(service.respondToTournamentInvitation(
        'session', tournament.tournamentId, 'captain', 'Accepted', experience, undefined, idFile,
      )).rejects.toThrow();
      expect(table.updateEntity).not.toHaveBeenCalled();
    });

    it('reports concurrent acceptance conflicts instead of overwriting another player ID', async () => {
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('partner'));
      table.updateEntity.mockRejectedValue({ statusCode: 412 });
      await expect(service.respondToTournamentInvitation(
        'session', tournament.tournamentId, 'captain', 'Accepted', experience, undefined, idFile,
      )).rejects.toThrow('invitation changed');
      expect(table.updateEntity).toHaveBeenCalledWith(expect.objectContaining({ EligibilityDetails: expect.any(String) }), 'Merge', { etag: 'v1' });
    });

    it('restricts ID downloads to admins and validates the stored document location', async () => {
      await service.registerTournamentTeam(
        'session', tournament.tournamentId, 'partner', experience, undefined, undefined, idFile,
      );
      const downloadToBuffer = jest.fn().mockResolvedValue(idBuffer);
      jest.spyOn(service as any, 'getTournamentIdContainerClient').mockReturnValue({
        getBlockBlobClient: jest.fn().mockReturnValue({ downloadToBuffer }),
      });
      await expect(service.getTournamentPlayerId('session', tournament.tournamentId, 'captain', 'captain'))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(downloadToBuffer).not.toHaveBeenCalled();
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      await expect(service.getTournamentPlayerId('session', tournament.tournamentId, 'captain', 'captain'))
        .resolves.toEqual({ buffer: idBuffer, contentType: 'application/pdf' });
      await expect(service.getTournamentPlayerId('session', tournament.tournamentId, 'captain', 'missing'))
        .rejects.toBeInstanceOf(NotFoundException);
      const details = JSON.parse(String(entity.EligibilityDetails));
      details[0].blobName = 'tournament-player-ids/another-event/secret.pdf';
      entity.EligibilityDetails = JSON.stringify(details);
      downloadToBuffer.mockClear();
      await expect(service.getTournamentPlayerId('session', tournament.tournamentId, 'captain', 'captain'))
        .rejects.toThrow('invalid storage location');
      expect(downloadToBuffer).not.toHaveBeenCalled();
    });

    it('rejects uploads when the ID container allows anonymous access', async () => {
      service['getTournamentIdContainerClient'] = jest.fn().mockReturnValue({
        getProperties: jest.fn().mockResolvedValue({ blobPublicAccess: 'blob' }),
        getBlockBlobClient: jest.fn(),
      });
      await expect(service.registerTournamentTeam('session', tournament.tournamentId, 'partner', experience, undefined, undefined, idFile))
        .rejects.toThrow('must not allow anonymous access');
      expect(service['uploadParticipationBlob']).not.toHaveBeenCalled();
      expect(table.createEntity).not.toHaveBeenCalled();
    });

    it('reads legacy IDs from the original container without treating them as private uploads', async () => {
      const downloadToBuffer = jest.fn().mockResolvedValue(idBuffer);
      entity.EligibilityDetails = JSON.stringify([{
        memberId: 'captain', memberName: 'Captain', fileName: 'id.pdf', uploadedAt: '', clubDetails: '',
        blobName: `tournament-player-ids/${tournament.tournamentId}/captain/id.pdf`, contentType: 'application/pdf',
      }]);
      jest.spyOn(service as any, 'getTournamentDocumentBlobClient').mockReturnValue({ downloadToBuffer });
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      await expect(service.getTournamentPlayerId('session', tournament.tournamentId, 'captain', 'captain'))
        .resolves.toEqual({ buffer: idBuffer, contentType: 'application/pdf' });
      expect(service['getTournamentIdContainerClient']).not.toHaveBeenCalled();
    });
  });

  describe('terms and conditions', () => {
    const termsUrl = `/tournaments/${tournament.tournamentId}/terms`;
    const buffer = Buffer.from('%PDF-1.7\nTournament terms');
    const file = { originalname: 'terms.pdf', mimetype: 'application/pdf', buffer, size: buffer.length };
    const input = { name: tournament.name, category: tournament.category, level: tournament.level, maxSlots: 8 };
    let createEntity: jest.Mock;
    let upload: jest.SpyInstance;
    let downloadToBuffer: jest.Mock;

    beforeEach(() => {
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      createEntity = jest.fn().mockResolvedValue(undefined);
      downloadToBuffer = jest.fn().mockResolvedValue(buffer);
      jest.spyOn(service as any, 'getTournamentsTableClient').mockReturnValue({
        createEntity,
        getEntity: jest.fn().mockResolvedValue({ TermsBlobName: `tournament-terms/${tournament.tournamentId}/terms.pdf` }),
      });
      jest.spyOn(service as any, 'getTournamentDocumentBlobClient').mockReturnValue({ downloadToBuffer });
      upload = jest.spyOn(service as any, 'uploadParticipationBlob').mockResolvedValue(undefined);
    });

    it('uploads a private PDF and persists its location without exposing it to players', async () => {
      const result = await service.createTournament('session', input, file);
      expect(result.termsUrl).toBe(`/tournaments/${result.tournamentId}/terms`);
      expect(result.termsFileName).toBe('terms.pdf');
      expect(upload).toHaveBeenCalledWith(expect.anything(), buffer, 'application/pdf');
      expect(createEntity).toHaveBeenCalledWith(expect.objectContaining({
        TermsBlobName: expect.stringMatching(/^tournament-terms\/.+\/.+\.pdf$/),
        TermsFileName: 'terms.pdf',
      }));
      const stored = createEntity.mock.calls[0][0];
      expect((service as any).toTournament(stored)).toMatchObject({ termsUrl: result.termsUrl, termsFileName: 'terms.pdf' });
    });

    it.each([
      { regularPrice: 0 },
      { regularPrice: 500.25 },
      { regularPrice: 1000000, earlyBirdPrice: 0, earlyBirdEndDate: '2028-02-29' },
      { regularPrice: 500, earlyBirdPrice: 400, earlyBirdEndDate: '2026-10-31' },
    ])('round-trips fee configuration for JSON and multipart creation: %p', async (pricing) => {
      for (const value of [pricing, JSON.stringify(pricing)]) {
        createEntity.mockClear();
        const result = await service.createTournament('session', { ...input, pricing: value });
        expect(result.pricing).toEqual(pricing);
        const stored = createEntity.mock.calls[0][0];
        expect(JSON.parse(stored.RegistrationPricing)).toEqual(pricing);
        expect(service['toTournament'](stored)?.pricing).toEqual(pricing);
      }
    });

    it.each([
      'not JSON', '[]', '1', '{}', '{"regularPrice":-1}', '{"regularPrice":1.001}',
      '{"regularPrice":"500"}', '{"regularPrice":1000001}', '{"regularPrice":null}',
      '{"earlyBirdPrice":100}', '{"regularPrice":500,"earlyBirdPrice":400}',
      '{"regularPrice":500,"earlyBirdEndDate":"2026-10-31"}',
      '{"regularPrice":500,"earlyBirdPrice":501,"earlyBirdEndDate":"2026-10-31"}',
      '{"regularPrice":500,"earlyBirdPrice":400,"earlyBirdEndDate":"2026-02-29"}',
      '{"regularPrice":500,"earlyBirdPrice":400,"earlyBirdEndDate":"2026-04-31"}',
      '{"regularPrice":500,"earlyBirdPrice":400,"earlyBirdEndDate":"2026-13-01"}',
      '{"regularPrice":500,"earlyBirdPrice":400,"earlyBirdEndDate":"2026-10-31T00:00:00Z"}',
    ])('rejects invalid pricing before any document or entity writes: %s', async (pricing) => {
      await expect(service.createTournament('session', { ...input, pricing }, file)).rejects.toBeInstanceOf(BadRequestException);
      expect(createEntity).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    });

    it('requires finite prices and distinguishes unannounced pricing from free', () => {
      for (const regularPrice of [NaN, Infinity, -Infinity]) {
        expect(() => service['validateTournamentPricing']({ regularPrice })).toThrow(BadRequestException);
      }
      expect(service['validateTournamentPricing'](null)).toBeUndefined();
      expect(service['validateTournamentPricing'](undefined)).toBeUndefined();
      expect(service['validateTournamentPricing']({ regularPrice: 0 })).toEqual({ regularPrice: 0 });
    });

    it('updates and removes fees only as an administrator without changing registrations', async () => {
      const updateEntity = jest.fn().mockResolvedValue(undefined);
      service['getTournamentsTableClient'] = jest.fn().mockReturnValue({ updateEntity });
      const pricing = { regularPrice: 500, earlyBirdPrice: 400, earlyBirdEndDate: '2026-10-31' };
      await expect(service.setTournamentPricing('session', tournament.tournamentId, pricing))
        .resolves.toMatchObject({ pricing });
      expect(updateEntity).toHaveBeenLastCalledWith({
        partitionKey: 'tournaments', rowKey: tournament.tournamentId, RegistrationPricing: JSON.stringify(pricing),
      }, 'Merge');
      service['getTournament'] = jest.fn().mockResolvedValue({ ...tournament, pricing });
      expect((await service.setTournamentPricing('session', tournament.tournamentId, null)).pricing).toBeUndefined();
      expect(updateEntity).toHaveBeenLastCalledWith({
        partitionKey: 'tournaments', rowKey: tournament.tournamentId, RegistrationPricing: 'null',
      }, 'Merge');
      await expect(service.setTournamentPricing('session', tournament.tournamentId, undefined)).rejects.toBeInstanceOf(BadRequestException);
      service['getMemberSession'] = jest.fn().mockResolvedValue(memberSession('member'));
      await expect(service.setTournamentPricing('session', tournament.tournamentId, pricing)).rejects.toBeInstanceOf(ForbiddenException);
      expect(updateEntity).toHaveBeenCalledTimes(2);
    });

    it('reports pricing storage errors without returning success', async () => {
      const updateEntity = jest.fn().mockRejectedValue({ statusCode: 404 });
      service['getTournamentsTableClient'] = jest.fn().mockReturnValue({ updateEntity });
      await expect(service.setTournamentPricing('session', tournament.tournamentId, { regularPrice: 500 }))
        .rejects.toBeInstanceOf(NotFoundException);
      updateEntity.mockRejectedValue(new Error('Storage down'));
      await expect(service.setTournamentPricing('session', tournament.tournamentId, { regularPrice: 500 })).rejects.toThrow();
    });

    it('keeps terms optional', async () => {
      const result = await service.createTournament('session', input);
      expect(result.termsUrl).toBeUndefined();
      expect(result.pricing).toBeUndefined();
      expect(upload).not.toHaveBeenCalled();
    });

    it.each([
      { sizes: ['XXXL', 'XXS', 'M', 'M'] as ('XXXL' | 'XXS' | 'M')[] },
      { sizes: '["XXXL","XXS","M","M"]' },
    ])('stores canonical available sizes from JSON or multipart input: %p', async ({ sizes }) => {
      const result = await service.createTournament('session', { ...input, tshirtSizes: sizes });
      expect(result.tshirtSizes).toEqual(['2XS', 'M', '3XL']);
      const stored = createEntity.mock.calls[0][0];
      expect(stored.TshirtSizes).toBe('["2XS","M","3XL"]');
      expect(service['toTournament'](stored)?.tshirtSizes).toEqual(['2XS', 'M', '3XL']);
    });

    it.each(['not JSON', '"M"', 'null', '["6XL"]', '{}'])('rejects invalid available sizes: %s', async (sizes) => {
      await expect(service.createTournament('session', { ...input, tshirtSizes: sizes }))
        .rejects.toThrow('Select available T-shirt sizes');
      expect(createEntity).not.toHaveBeenCalled();
    });

    it('updates and disables options as an administrator without rewriting registrations', async () => {
      const updateEntity = jest.fn().mockResolvedValue(undefined);
      service['getTournamentsTableClient'] = jest.fn().mockReturnValue({ updateEntity });
      await expect(service.setTournamentTshirtSizes('session', tournament.tournamentId, ['XXXL', 'S']))
        .resolves.toMatchObject({ tshirtSizes: ['S', '3XL'] });
      expect(updateEntity).toHaveBeenLastCalledWith({
        partitionKey: 'tournaments', rowKey: tournament.tournamentId, TshirtSizes: '["S","3XL"]',
      }, 'Merge');
      await expect(service.setTournamentTshirtSizes('session', tournament.tournamentId, []))
        .resolves.toMatchObject({ tshirtSizes: [] });
      await expect(service.setTournamentTshirtSizes('session', tournament.tournamentId, undefined))
        .rejects.toThrow('Specify the available T-shirt sizes');
      service['getMemberSession'] = jest.fn().mockResolvedValue(memberSession('member'));
      await expect(service.setTournamentTshirtSizes('session', tournament.tournamentId, ['M']))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(updateEntity).toHaveBeenCalledTimes(2);
    });

    it('reports option validation and storage failures instead of returning success', async () => {
      const updateEntity = jest.fn().mockRejectedValue({ statusCode: 404 });
      service['getTournamentsTableClient'] = jest.fn().mockReturnValue({ updateEntity });
      await expect(service.setTournamentTshirtSizes('session', tournament.tournamentId, ['6XL']))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(updateEntity).not.toHaveBeenCalled();
      await expect(service.setTournamentTshirtSizes('session', tournament.tournamentId, ['M']))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('accepts a PDF at exactly the 10 MB limit', async () => {
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024);
      largeBuffer.write('%PDF-1.7');
      await expect(service.createTournament('session', input, {
        ...file, buffer: largeBuffer, size: largeBuffer.length,
      })).resolves.toMatchObject({ termsFileName: 'terms.pdf' });
      expect(upload).toHaveBeenCalled();
    });

    it.each([
      { ...file, mimetype: 'text/html' },
      { ...file, buffer: Buffer.from('not a pdf'), size: 9 },
      { ...file, size: 0 },
      { ...file, size: 10 * 1024 * 1024 + 1 },
    ])('rejects invalid documents before publishing the tournament', async (invalid) => {
      await expect(service.createTournament('session', input, invalid)).rejects.toThrow('must be a PDF');
      expect(upload).not.toHaveBeenCalled();
      expect(createEntity).not.toHaveBeenCalled();
    });

    it('does not publish a tournament when its document upload fails', async () => {
      upload.mockRejectedValue(new Error('Storage unavailable'));
      await expect(service.createTournament('session', input, file)).rejects.toThrow();
      expect(createEntity).not.toHaveBeenCalled();
    });

    it('rejects non-admin creation before uploading anything', async () => {
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('player'));
      await expect(service.createTournament('session', input, file)).rejects.toBeInstanceOf(ForbiddenException);
      expect(upload).not.toHaveBeenCalled();
    });

    it('serves the PDF only after authenticating a member', async () => {
      await expect(service.getTournamentTerms('session', tournament.tournamentId)).resolves.toEqual(buffer);
      expect((service as any).getMemberSession).toHaveBeenCalledWith('session');
      jest.spyOn(service as any, 'getMemberSession').mockRejectedValue(new ForbiddenException());
      downloadToBuffer.mockClear();
      await expect(service.getTournamentTerms('', tournament.tournamentId)).rejects.toBeInstanceOf(ForbiddenException);
      expect(downloadToBuffer).not.toHaveBeenCalled();
    });

    it('reports missing terms clearly', async () => {
      jest.spyOn(service as any, 'getTournamentsTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue({}),
      });
      await expect(service.getTournamentTerms('session', tournament.tournamentId)).rejects.toThrow('has no terms');
      expect(downloadToBuffer).not.toHaveBeenCalled();
    });

    it('does not download a document belonging to another tournament', async () => {
      jest.spyOn(service as any, 'getTournamentsTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue({ TermsBlobName: 'tournament-terms/another-event/terms.pdf' }),
      });
      await expect(service.getTournamentTerms('session', tournament.tournamentId)).rejects.toThrow('location is invalid');
      expect(downloadToBuffer).not.toHaveBeenCalled();
    });

    it('reports an unavailable stored PDF rather than returning an empty document', async () => {
      downloadToBuffer.mockRejectedValue({ statusCode: 404 });
      await expect(service.getTournamentTerms('session', tournament.tournamentId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([undefined, false, 'true', 1])('rejects registration without explicit agreement (%s)', async (accepted) => {
      jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, termsUrl });
      await expect(service.registerTournamentTeam('session', tournament.tournamentId, 'partner', experience, undefined, accepted))
        .rejects.toThrow('must agree');
    });

    it('records sender agreement and includes the link in stored invitations', async () => {
      jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, termsUrl });
      jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'Partner', gender: 'Male' });
      jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([]);
      jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue({ createEntity });
      const result = await service.registerTournamentTeam('session', tournament.tournamentId, 'partner', experience, undefined, true, idFile);
      expect(result).toMatchObject({ termsUrl, memberTermsAcceptedAt: expect.any(String) });
      const stored = createEntity.mock.calls[0][0];
      expect(stored).toMatchObject({ TermsRequired: true, MemberTermsAcceptedAt: result.memberTermsAcceptedAt });
      expect((service as any).toTournamentRegistration(stored)).toMatchObject({ termsUrl, memberTermsAcceptedAt: result.memberTermsAcceptedAt });
    });

    it.each(['Mens Doubles', 'Team Tournament'] as const)('requires and records invitee agreement for %s', async (category) => {
      jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, category, termsUrl });
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('partner'));
      jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'Captain', gender: 'Male' });
      const entity = {
        partitionKey: tournament.tournamentId, rowKey: 'captain', Category: category, Level: tournament.level,
        MemberId: 'captain', PartnerId: 'partner', Status: 'Invitation Pending', TermsRequired: true,
        ...(category === 'Team Tournament' ? {
          TeamMembers: JSON.stringify([
            { memberId: 'captain', name: 'Captain', gender: 'Male', accepted: true },
            { memberId: 'partner', name: 'Partner', gender: 'Male', accepted: false },
            { memberId: 'third', name: 'Third', gender: 'Female', accepted: false },
            { memberId: 'fourth', name: 'Fourth', gender: 'Female', accepted: false },
          ]),
        } : {}),
      };
      const updateEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue(entity), updateEntity,
      });
      jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([entity]);
      for (const accepted of [undefined, false, 'true']) {
        await expect(service.respondToTournamentInvitation('session', tournament.tournamentId, 'captain', 'Accepted', experience, accepted))
          .rejects.toThrow('must agree');
      }
      expect(updateEntity).not.toHaveBeenCalled();
      const result = await service.respondToTournamentInvitation('session', tournament.tournamentId, 'captain', 'Accepted', experience, true, idFile);
      expect(result.termsUrl).toBe(termsUrl);
      if (category === 'Team Tournament') {
        expect(result.teamMembers?.find((member) => member.memberId === 'partner')?.termsAcceptedAt).toEqual(expect.any(String));
      } else {
        expect(result.partnerTermsAcceptedAt).toEqual(expect.any(String));
      }
      await expect(service.respondToTournamentInvitation('session', tournament.tournamentId, 'captain', 'Declined'))
        .resolves.toMatchObject({ status: 'Invitation Declined' });
    });
  });

  it('counts only approved teams toward slots and reports pending teams separately per tournament', async () => {
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
    const statuses = ['Approved', 'Invitation Pending', 'Pending Approval', 'Invitation Pending', 'Pending Approval', 'Invitation Declined'];
    const entities = statuses.map((Status) => ({ TournamentId: tournament.tournamentId, Status }));
    entities.push({ TournamentId: 'other-event', Status: 'Paid' });
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue({
      listEntities: () => ({ async *[Symbol.asyncIterator]() { yield* entities; } }),
    });
    jest.spyOn(service as any, 'getTournamentsTableClient').mockReturnValue({
      listEntities: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            rowKey: tournament.tournamentId, TournamentId: tournament.tournamentId,
            Name: tournament.name, Category: tournament.category, Level: tournament.level, MaxSlots: 5,
          };
        },
      }),
    });
    await expect(service.getTournaments('session')).resolves.toEqual([
      expect.objectContaining({ registrationCount: 1, pendingRegistrationCount: 4, maxSlots: 5 }),
    ]);
    entities.push(
      { TournamentId: tournament.tournamentId, Status: 'Payment Submitted' },
      { TournamentId: tournament.tournamentId, Status: 'Paid' },
    );
    await expect(service.getTournaments('session')).resolves.toEqual([
      expect.objectContaining({ registrationCount: 3, pendingRegistrationCount: 4 }),
    ]);
  });

  it('allows new invitations when pending registrations exceed the slot limit', async () => {
    jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, maxSlots: 1 });
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('new-member'));
    jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'New Partner', gender: 'Male' });
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([
      { MemberId: 'captain', PartnerId: 'partner', Status: 'Invitation Pending' },
      { MemberId: 'captain-2', PartnerId: 'partner-2', Status: 'Pending Approval' },
    ]);
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue({
      createEntity: jest.fn().mockResolvedValue(undefined),
    });
    await expect(service.registerTournamentTeam('session', tournament.tournamentId, 'new-partner', experience, undefined, undefined, idFile))
      .resolves.toMatchObject({ status: 'Invitation Pending' });
  });

  it.each(['Approved', 'Payment Submitted', 'Paid'])('rejects new invitations when a %s team fills the last slot', async (status) => {
    jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, maxSlots: 1 });
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('new-member'));
    jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'New Partner', gender: 'Male' });
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([
      { MemberId: 'captain', PartnerId: 'partner', Status: status },
    ]);
    await expect(service.registerTournamentTeam('session', tournament.tournamentId, 'new-partner', experience))
      .rejects.toThrow('maximum number of team slots');
  });

  it.each(['Approved', 'Payment Submitted', 'Paid'])('prevents approval beyond capacity occupied by a %s team', async (status) => {
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
    jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, maxSlots: 1 });
    const updateEntity = jest.fn();
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue({
      getEntity: jest.fn().mockResolvedValue({ Status: 'Pending Approval', PartnerAccepted: true }),
      updateEntity,
    });
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([{ Status: status }]);
    await expect(service.approveTournamentRegistration('session', tournament.tournamentId, 'pending-team'))
      .rejects.toThrow('maximum number of approved teams');
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it('approves the last available slot without counting other pending entries', async () => {
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
    jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, maxSlots: 1 });
    const updateEntity = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue({
      getEntity: jest.fn().mockResolvedValue({
        rowKey: 'pending-team', partitionKey: tournament.tournamentId,
        Category: tournament.category, Level: tournament.level, Status: 'Pending Approval', PartnerAccepted: true, etag: 'v1',
      }),
      updateEntity,
    });
    jest.spyOn(service as any, 'prepareTournamentApprovalEmails').mockResolvedValue([]);
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([
      { Status: 'Invitation Pending' }, { Status: 'Pending Approval' },
    ]);
    await expect(service.approveTournamentRegistration('session', tournament.tournamentId, 'pending-team'))
      .resolves.toMatchObject({ status: 'Approved' });
    expect(updateEntity).toHaveBeenCalled();
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

  it.each([
    ['Mens Doubles', 'Male', 'Male'],
    ['Womens Doubles', 'Female', 'Female'],
    ['Mixed Doubles', 'Male', 'Female'],
    ['Mixed Doubles', 'Female', 'Male'],
  ] as const)('creates a %s invitation for %s + %s', async (category, memberGender, partnerGender) => {
    const table = { createEntity: jest.fn().mockResolvedValue(undefined) };
    jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, category });
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a', memberGender));
    jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'member-b', gender: partnerGender });
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([]);
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    const registration = await service.registerTournamentTeam(
      'session',
      tournament.tournamentId,
      'member-b',
      experience,
      undefined, undefined, idFile,
    );

    expect(registration.status).toBe('Invitation Pending');
    expect(table.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: tournament.tournamentId,
        rowKey: 'member-a',
        Category: category,
        PartnerId: 'member-b',
        Status: 'Invitation Pending',
      }),
    );
  });

  it.each([false, true])('creates a 2-and-2 Team Tournament roster (terms required: %s)', async (hasTerms) => {
    const teamMembers = new Map([
      ['member-b', { name: 'Member B', gender: 'Male' }],
      ['member-c', { name: 'Member C', gender: 'Female' }],
      ['member-d', { name: 'Member D', gender: 'Female' }],
    ]);
    const table = { createEntity: jest.fn().mockResolvedValue(undefined) };
    jest.spyOn(service as any, 'getTournament').mockResolvedValue({
      ...teamTournament, ...(hasTerms ? { termsUrl: '/tournaments/team/terms' } : {}),
    });
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
      hasTerms,
      idFile,
    );

    expect(registration.status).toBe('Invitation Pending');
    expect(registration.teamMembers?.map((member) => [member.memberId, member.accepted])).toEqual([
      ['member-a', true],
      ['member-b', false],
      ['member-c', false],
      ['member-d', false],
    ]);
    expect(JSON.parse(table.createEntity.mock.calls[0][0].TeamMembers)).toHaveLength(4);
    expect(registration.teamMembers?.[0].termsAcceptedAt).toEqual(hasTerms ? expect.any(String) : undefined);
    expect(registration.teamMembers?.slice(1).every((member) => member.termsAcceptedAt === undefined)).toBe(true);
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

  it.each([
    ['Mens Doubles', 'Male', 'Female'],
    ['Mens Doubles', 'Female', 'Male'],
    ['Mens Doubles', 'Female', 'Female'],
    ['Womens Doubles', 'Female', 'Male'],
    ['Womens Doubles', 'Male', 'Female'],
    ['Womens Doubles', 'Male', 'Male'],
    ['Mixed Doubles', 'Male', 'Male'],
    ['Mixed Doubles', 'Female', 'Female'],
    ['Mixed Doubles', '', 'Female'],
    ['Mixed Doubles', 'Male', ''],
  ] as const)('rejects a %s invitation for %s + %s', async (category, memberGender, partnerGender) => {
    const table = { createEntity: jest.fn() };
    jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, category });
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a', memberGender));
    jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'member-b', gender: partnerGender });
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    await expect(
      service.registerTournamentTeam('session', tournament.tournamentId, 'member-b', experience),
    ).rejects.toThrow('gender requirements');
    expect(table.createEntity).not.toHaveBeenCalled();
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

  it.each([
    ['Mens Doubles', 'Male', 'Male'],
    ['Womens Doubles', 'Female', 'Female'],
    ['Mixed Doubles', 'Male', 'Female'],
    ['Mixed Doubles', 'Female', 'Male'],
  ] as const)('moves an accepted %s invitation for %s + %s to pending approval', async (category, memberGender, partnerGender) => {
    const invitation = {
      partitionKey: tournament.tournamentId,
      rowKey: 'member-a',
      MemberId: 'member-a',
      MemberName: 'member-a',
      PartnerId: 'member-b',
      PartnerName: 'member-b',
      TournamentId: tournament.tournamentId,
      TournamentName: tournament.name,
      Category: category,
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
    jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, category });
    jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-b', partnerGender));
    jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'member-a', gender: memberGender });
    jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue([invitation]);
    jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);

    const result = await service.respondToTournamentInvitation(
      'session',
      tournament.tournamentId,
      'member-a',
      'Accepted',
      experience,
      undefined, idFile,
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
      { etag: '*' },
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
        'session', teamTournament.tournamentId, 'member-a', 'Accepted', experience, undefined, idFile,
      );
      expect(result.status).toBe(expectedStatus);
      expect(result.teamMembers?.find((member) => member.memberId === memberId)).toMatchObject({
        accepted: true,
        experience,
      });
    }
    expect(JSON.parse(String(invitation.TeamMembers)).every((member: { accepted: boolean }) => member.accepted)).toBe(true);
    expect(JSON.parse(String(invitation.EligibilityDetails)).map((details: { memberId: string }) => details.memberId))
      .toEqual(['member-b', 'member-c', 'member-d']);
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

  describe('cancelling unpaid registrations', () => {
    const roster = [
      { memberId: 'member-a', name: 'A', gender: 'Male', accepted: true },
      { memberId: 'member-b', name: 'B', gender: 'Male', accepted: true },
      { memberId: 'member-c', name: 'C', gender: 'Female', accepted: false },
      { memberId: 'member-d', name: 'D', gender: 'Female', accepted: true },
    ];
    let table: {
      getEntity: jest.Mock;
      deleteEntity: jest.Mock;
    };

    beforeEach(() => {
      table = {
        getEntity: jest.fn().mockResolvedValue({
          MemberId: 'member-a',
          PartnerId: 'member-b',
          Status: 'Invitation Pending',
          TeamMembers: JSON.stringify(roster),
          etag: 'registration-version',
        }),
        deleteEntity: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
    });

    it.each(
      ['Invitation Pending', 'Pending Approval', 'Approved', 'Payment Submitted'].flatMap((status) =>
        roster.map(({ memberId }) => [status, memberId]),
      ),
    )('allows cancellation of %s by %s', async (status, memberId) => {
      table.getEntity.mockResolvedValue({
        MemberId: 'member-a', PartnerId: 'member-b', Status: status,
        TeamMembers: JSON.stringify(roster), etag: 'registration-version',
      });
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession(memberId));

      await expect(service.cancelTournamentRegistration(
        'session', tournament.tournamentId, 'member-a',
      )).resolves.toEqual({ deleted: true });
      expect(table.deleteEntity).toHaveBeenCalledWith(
        tournament.tournamentId, 'member-a', { etag: 'registration-version' },
      );
    });

    it.each(['member-a', 'member-b'])('allows doubles cancellation by %s', async (memberId) => {
      table.getEntity.mockResolvedValue({
        MemberId: 'member-a', PartnerId: 'member-b', Status: 'Approved', etag: 'doubles-version',
      });
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession(memberId));
      await expect(service.cancelTournamentRegistration(
        'session', tournament.tournamentId, 'member-a',
      )).resolves.toEqual({ deleted: true });
    });

    it('rejects an unrelated member', async () => {
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('outsider'));
      await expect(service.cancelTournamentRegistration(
        'session', tournament.tournamentId, 'member-a',
      )).rejects.toBeInstanceOf(ForbiddenException);
      expect(table.deleteEntity).not.toHaveBeenCalled();
    });

    it.each([
      { Status: 'Paid' },
      { Status: 'Invitation Declined' },
    ])('rejects cancellation for %o', async (paymentState) => {
      table.getEntity.mockResolvedValue({
        MemberId: 'member-a', PartnerId: 'member-b', ...paymentState,
      });
      await expect(service.cancelTournamentRegistration(
        'session', tournament.tournamentId, 'member-a',
      )).rejects.toBeInstanceOf(ConflictException);
      expect(table.deleteEntity).not.toHaveBeenCalled();
    });

    it('reports a missing registration', async () => {
      table.getEntity.mockRejectedValue({ statusCode: 404 });
      await expect(service.cancelTournamentRegistration(
        'session', tournament.tournamentId, 'member-a',
      )).rejects.toBeInstanceOf(NotFoundException);
      expect(table.deleteEntity).not.toHaveBeenCalled();
    });

    it('rejects cancellation if payment or another update wins the race', async () => {
      table.deleteEntity.mockRejectedValue({ statusCode: 412 });
      await expect(service.cancelTournamentRegistration(
        'session', tournament.tournamentId, 'member-a',
      )).rejects.toThrow('The registration changed');
    });

    it('releases the slot and lets a former teammate register again', async () => {
      let entries = [{
        MemberId: 'member-a', PartnerId: 'member-b', Status: 'Invitation Pending',
        TeamMembers: JSON.stringify(roster),
      }];
      table.deleteEntity.mockImplementation(async () => { entries = []; });
      jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockImplementation(async () => entries);
      jest.spyOn(service as any, 'getTournament').mockResolvedValue({ ...tournament, maxSlots: 1 });
      const createEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue({ ...table, createEntity });
      jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'New Partner', gender: 'Male' });
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-b'));

      await service.cancelTournamentRegistration('session', tournament.tournamentId, 'member-a');
      await expect(service.registerTournamentTeam(
        'session', tournament.tournamentId, 'new-partner', experience, undefined, undefined, idFile,
      )).resolves.toMatchObject({ memberId: 'member-b', status: 'Invitation Pending' });
      expect(createEntity).toHaveBeenCalled();
    });
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

  describe('payment proofs and admin payment confirmation', () => {
    const file = { originalname: 'receipt.pdf', buffer: Buffer.from('receipt'), mimetype: 'application/pdf', size: 7 };
    const storedProof = {
      memberId: 'member-b', memberName: 'B', fileName: 'old.pdf', uploadedAt: '2026-10-19T00:00:00Z',
      blobName: `tournament-payment-proofs/${tournament.tournamentId}/member-a/old.pdf`,
      contentType: 'application/pdf',
    };
    let entity: Record<string, unknown>;
    let table: { getEntity: jest.Mock; updateEntity: jest.Mock; deleteEntity: jest.Mock };
    let blob: { downloadToBuffer: jest.Mock };
    let upload: jest.SpyInstance;

    beforeEach(() => {
      entity = {
        partitionKey: tournament.tournamentId, rowKey: 'member-a',
        TournamentId: tournament.tournamentId, Category: 'Team Tournament', Level: 'Intermediate',
        MemberId: 'member-a', PartnerId: 'member-b', Status: 'Approved', etag: 'version-1',
        TeamMembers: JSON.stringify([
          { memberId: 'member-a', name: 'A', gender: 'Male', accepted: true },
          { memberId: 'member-b', name: 'B', gender: 'Male', accepted: true },
          { memberId: 'member-c', name: 'C', gender: 'Female', accepted: true },
          { memberId: 'member-d', name: 'D', gender: 'Female', accepted: true },
        ]),
      };
      table = {
        getEntity: jest.fn(async () => ({ ...entity })),
        updateEntity: jest.fn(async (update: Record<string, unknown>) => { entity = { ...entity, ...update }; }),
        deleteEntity: jest.fn().mockResolvedValue(undefined),
      };
      blob = { downloadToBuffer: jest.fn().mockResolvedValue(file.buffer) };
      jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue(table);
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-c', 'Female'));
      jest.spyOn(service as any, 'getTournamentPaymentProofBlobClient').mockReturnValue(blob);
      upload = jest.spyOn(service as any, 'uploadParticipationBlob').mockResolvedValue(undefined);
    });

    it.each(['member-a', 'member-b', 'member-c', 'member-d'])('allows approved roster member %s to upload', async (memberId) => {
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession(memberId));
      const result = await service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', file);
      expect(result.status).toBe('Payment Submitted');
      expect(result.paymentProofs).toEqual([expect.objectContaining({
        memberId, fileName: 'receipt.pdf',
        url: expect.stringContaining(`/payment-proofs/${memberId}`),
      })]);
      expect(upload).toHaveBeenCalledWith(blob, file.buffer, file.mimetype);
      expect(table.updateEntity).toHaveBeenCalledWith(expect.any(Object), 'Merge', { etag: 'version-1' });
    });

    it('allows a doubles partner to upload without a four-player roster', async () => {
      delete entity.TeamMembers;
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-b'));
      await expect(service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', file))
        .resolves.toMatchObject({ status: 'Payment Submitted' });
    });

    it('retains other players proofs and replaces only the current players proof', async () => {
      entity.Status = 'Payment Submitted';
      entity.PaymentProofs = JSON.stringify([storedProof]);
      await service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', file);
      const result = await service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', { ...file, originalname: 'replacement.pdf' });
      expect(result.paymentProofs).toHaveLength(2);
      expect(result.paymentProofs?.find((proof) => proof.memberId === 'member-b')?.fileName).toBe('old.pdf');
      expect(result.paymentProofs?.find((proof) => proof.memberId === 'member-c')?.fileName).toBe('replacement.pdf');
    });

    it('retries concurrent proof updates without losing the other upload', async () => {
      table.updateEntity.mockImplementationOnce(async () => {
        entity.PaymentProofs = JSON.stringify([storedProof]);
        entity.etag = 'version-2';
        throw { statusCode: 412 };
      });
      const result = await service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', file);
      expect(result.paymentProofs).toHaveLength(2);
      expect(table.updateEntity).toHaveBeenLastCalledWith(expect.any(Object), 'Merge', { etag: 'version-2' });
    });

    it('does not overwrite Paid if payment confirmation wins during upload', async () => {
      upload.mockImplementation(async () => { entity.Status = 'Paid'; });
      await expect(service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', file))
        .rejects.toBeInstanceOf(ConflictException);
      expect(table.updateEntity).not.toHaveBeenCalled();
      expect(entity.Status).toBe('Paid');
    });

    it('rejects a late upload if the registration was replaced with a different roster', async () => {
      upload.mockImplementation(async () => {
        entity.TeamMembers = JSON.stringify([
          { memberId: 'member-a', name: 'A', gender: 'Male', accepted: true },
          { memberId: 'new-member', name: 'New Member', gender: 'Female', accepted: true },
        ]);
      });
      await expect(service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', file))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(table.updateEntity).not.toHaveBeenCalled();
    });

    it.each(['Paid', 'Invitation Pending', 'Pending Approval'])('blocks uploads for %s', async (status) => {
      entity.Status = status;
      await expect(service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', file))
        .rejects.toBeInstanceOf(ConflictException);
      expect(upload).not.toHaveBeenCalled();
    });

    it('blocks uploads by outsiders', async () => {
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('outsider'));
      await expect(service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', file))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(upload).not.toHaveBeenCalled();
    });

    it.each([
      { mimetype: 'text/html', size: 7 },
      { mimetype: 'application/pdf', size: 0 },
      { mimetype: 'application/pdf', size: 10 * 1024 * 1024 + 1 },
    ])('rejects invalid uploads %o', async (invalid) => {
      await expect(service.uploadTournamentPaymentProof('session', tournament.tournamentId, 'member-a', { ...file, ...invalid }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(upload).not.toHaveBeenCalled();
    });

    it.each(['Approved', 'Payment Submitted'])('lets an admin mark %s paid without requiring any proof', async (status) => {
      entity.Status = status;
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      const result = await service.markTournamentRegistrationPaid('session', tournament.tournamentId, 'member-a');
      expect(result).toMatchObject({ status: 'Paid', paidBy: 'admin', paidAt: expect.any(String) });
      expect(result.paymentProofs).toEqual([]);
    });

    it('retains every proof when marked paid', async () => {
      entity.PaymentProofs = JSON.stringify(['member-a', 'member-b', 'member-c', 'member-d'].map((memberId) => ({
        ...storedProof, memberId,
      })));
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      const result = await service.markTournamentRegistrationPaid('session', tournament.tournamentId, 'member-a');
      expect(result.status).toBe('Paid');
      expect(result.paymentProofs).toHaveLength(4);
    });

    it.each(['Invitation Pending', 'Pending Approval', 'Invitation Declined', 'Paid'])('cannot mark %s paid', async (status) => {
      entity.Status = status;
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      await expect(service.markTournamentRegistrationPaid('session', tournament.tournamentId, 'member-a'))
        .rejects.toBeInstanceOf(ConflictException);
      expect(table.updateEntity).not.toHaveBeenCalled();
    });

    it('rejects non-admin payment confirmation and removal', async () => {
      await expect(service.markTournamentRegistrationPaid('session', tournament.tournamentId, 'member-a'))
        .rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.removeTournamentRegistration('session', tournament.tournamentId, 'member-a'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('only allows admins to remove paid registrations', async () => {
      entity.Status = 'Paid';
      await expect(service.cancelTournamentRegistration('session', tournament.tournamentId, 'member-a'))
        .rejects.toBeInstanceOf(ConflictException);
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      await expect(service.removeTournamentRegistration('session', tournament.tournamentId, 'member-a'))
        .resolves.toEqual({ deleted: true });
      expect(table.deleteEntity).toHaveBeenCalledWith(tournament.tournamentId, 'member-a', { etag: 'version-1' });
    });

    it('reports a concurrent update rather than overwriting payment changes', async () => {
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      table.updateEntity.mockRejectedValue({ statusCode: 412 });
      await expect(service.markTournamentRegistrationPaid('session', tournament.tournamentId, 'member-a'))
        .rejects.toBeInstanceOf(ConflictException);
    });

    it.each(['member-c', 'admin'])('serves private proofs to an authorized %s', async (memberId) => {
      entity.PaymentProofs = JSON.stringify([storedProof]);
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession(memberId, 'Female', memberId === 'admin' ? 'admin' : 'member'));
      await expect(service.getTournamentPaymentProof('session', tournament.tournamentId, 'member-a', 'member-b'))
        .resolves.toEqual({ buffer: file.buffer, contentType: 'application/pdf' });
      expect(blob.downloadToBuffer).toHaveBeenCalled();
    });

    it('blocks private proof access by outsiders', async () => {
      entity.PaymentProofs = JSON.stringify([storedProof]);
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('outsider'));
      await expect(service.getTournamentPaymentProof('session', tournament.tournamentId, 'member-a', 'member-b'))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(blob.downloadToBuffer).not.toHaveBeenCalled();
    });

    it('reports missing proofs', async () => {
      await expect(service.getTournamentPaymentProof('session', tournament.tournamentId, 'member-a', 'member-b'))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('preserves access to legacy proof uploads through the protected endpoint', async () => {
      Object.assign(service, { azureStorageAccount: 'testaccount', azureContainerName: 'proofs' });
      entity.PaymentProofUrl = `https://testaccount.blob.core.windows.net/proofs/tournament-payment-proofs/${tournament.tournamentId}/member-a/old.pdf`;
      await expect(service.getTournamentPaymentProof('session', tournament.tournamentId, 'member-a', 'legacy'))
        .resolves.toEqual({ buffer: file.buffer, contentType: 'application/pdf' });
    });
  });

  describe('closing registration, roster, and protests', () => {
    const closedTournament = { ...tournament, registrationClosed: true, registrationClosedAt: '2026-10-05T00:00:00.000Z' };
    const protestId = '223e4567-e89b-12d3-a456-426614174001';
    const pdf = Buffer.from('%PDF-1.7\nEvidence');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const evidence = (overrides: Record<string, unknown> = {}) => ({
      originalname: 'evidence.pdf', mimetype: 'application/pdf', buffer: pdf, size: pdf.length, ...overrides,
    });
    const protestInput = {
      protestedMemberId: 'rival-a',
      eligibilityCategory: 'Skill level eligibility',
      reason: 'This player won an open-level event last month.',
    };
    const registrations = [
      { rowKey: 'member-a', MemberId: 'member-a', MemberName: 'Alice', PartnerId: 'member-b', PartnerName: 'Ben', Status: 'Paid' },
      { rowKey: 'rival-a', MemberId: 'rival-a', MemberName: 'Rita', PartnerId: 'rival-b', PartnerName: 'Rob', Status: 'Approved' },
      { rowKey: 'pending-a', MemberId: 'pending-a', MemberName: 'Pat', PartnerId: 'pending-b', Status: 'Pending Approval' },
    ];
    let protestsTable: { createEntity: jest.Mock; updateEntity: jest.Mock; getEntity: jest.Mock; listEntities: jest.Mock };
    let protestEntities: Record<string, unknown>[];
    let upload: jest.SpyInstance;
    let blob: { downloadToBuffer: jest.Mock; deleteIfExists: jest.Mock };

    beforeEach(() => {
      protestEntities = [];
      jest.spyOn(service as any, 'getTournament').mockResolvedValue(closedTournament);
      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
      jest.spyOn(service as any, 'getTournamentRegistrationEntities').mockResolvedValue(registrations);
      jest.spyOn(service as any, 'getMembersTableClient').mockReturnValue({
        getEntity: jest.fn().mockImplementation((_partition: string, id: string) =>
          Promise.resolve({ Gender: id.endsWith('b') ? 'Male' : 'Female' })),
      });
      protestsTable = {
        createEntity: jest.fn().mockResolvedValue(undefined),
        updateEntity: jest.fn().mockResolvedValue(undefined),
        getEntity: jest.fn(),
        listEntities: jest.fn().mockImplementation(() => (async function* () { yield* protestEntities; })()),
      };
      jest.spyOn(service as any, 'getTournamentProtestsTableClient').mockReturnValue(protestsTable);
      blob = { downloadToBuffer: jest.fn().mockResolvedValue(pdf), deleteIfExists: jest.fn().mockResolvedValue(undefined) };
      jest.spyOn(service as any, 'getTournamentDocumentBlobClient').mockReturnValue(blob);
      upload = jest.spyOn(service as any, 'uploadParticipationBlob').mockResolvedValue(undefined);
    });

    describe('registration status', () => {
      let updateEntity: jest.Mock;

      beforeEach(() => {
        updateEntity = jest.fn().mockResolvedValue(undefined);
        jest.spyOn(service as any, 'getTournament').mockResolvedValue(tournament);
        jest.spyOn(service as any, 'getTournamentsTableClient').mockReturnValue({ updateEntity });
        jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      });

      it('lets administrators close and reopen registration', async () => {
        const closed = await service.setTournamentRegistrationClosed('session', tournament.tournamentId, true);
        expect(closed).toMatchObject({ registrationClosed: true, registrationClosedAt: expect.any(String), registrationCount: 2, pendingRegistrationCount: 1 });
        expect(updateEntity).toHaveBeenCalledWith(expect.objectContaining({ RegistrationClosed: true }), 'Merge');

        const reopened = await service.setTournamentRegistrationClosed('session', tournament.tournamentId, false);
        expect(reopened.registrationClosed).toBe(false);
        expect(reopened.registrationClosedAt).toBeUndefined();
        expect(updateEntity).toHaveBeenLastCalledWith(expect.objectContaining({ RegistrationClosed: false, RegistrationClosedAt: '' }), 'Merge');
      });

      it.each(['true', 1, undefined])('requires a boolean status (%s)', async (closed) => {
        await expect(service.setTournamentRegistrationClosed('session', tournament.tournamentId, closed))
          .rejects.toBeInstanceOf(BadRequestException);
        expect(updateEntity).not.toHaveBeenCalled();
      });

      it('rejects non-administrators', async () => {
        jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
        await expect(service.setTournamentRegistrationClosed('session', tournament.tournamentId, true))
          .rejects.toBeInstanceOf(ForbiddenException);
        expect(updateEntity).not.toHaveBeenCalled();
      });
    });

    it('blocks new registrations and invitation acceptance after registration closes, but still allows declining', async () => {
      await expect(service.registerTournamentTeam('session', tournament.tournamentId, 'partner', experience, undefined, true))
        .rejects.toThrow('Registration for this tournament is closed.');

      jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('partner'));
      jest.spyOn(service as any, 'getTournamentMember').mockResolvedValue({ name: 'Captain', gender: 'Male' });
      const invitation = {
        partitionKey: tournament.tournamentId, rowKey: 'captain', Category: tournament.category, Level: tournament.level,
        MemberId: 'captain', PartnerId: 'partner', Status: 'Invitation Pending',
      };
      const updateEntity = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getTournamentRegistrationsTableClient').mockReturnValue({
        getEntity: jest.fn().mockResolvedValue(invitation), updateEntity,
      });
      await expect(service.respondToTournamentInvitation('session', tournament.tournamentId, 'captain', 'Accepted', experience, true))
        .rejects.toBeInstanceOf(ConflictException);
      expect(updateEntity).not.toHaveBeenCalled();
      await expect(service.respondToTournamentInvitation('session', tournament.tournamentId, 'captain', 'Declined'))
        .resolves.toMatchObject({ status: 'Invitation Declined' });
    });

    describe('roster', () => {
      it('shows confirmed teams to confirmed participants after registration closes', async () => {
        const roster = await service.getTournamentRoster('session', tournament.tournamentId);
        expect(roster.teams).toEqual([
          {
            registrationId: 'member-a', status: 'Paid', isOwnTeam: true,
            players: [{ memberId: 'member-a', name: 'Alice', gender: 'Female' }, { memberId: 'member-b', name: 'Ben', gender: 'Male' }],
          },
          {
            registrationId: 'rival-a', status: 'Approved', isOwnTeam: false,
            players: [{ memberId: 'rival-a', name: 'Rita', gender: 'Female' }, { memberId: 'rival-b', name: 'Rob', gender: 'Male' }],
          },
        ]);
        expect(roster.canManageRoster).toBe(false);
      });

      it('hides the roster from players while registration is open', async () => {
        jest.spyOn(service as any, 'getTournament').mockResolvedValue(tournament);
        await expect(service.getTournamentRoster('session', tournament.tournamentId))
          .rejects.toThrow('The roster is available after registration closes.');
      });

      it.each(['pending-a', 'outsider'])('hides the roster from unconfirmed member %s', async (memberId) => {
        jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession(memberId));
        await expect(service.getTournamentRoster('session', tournament.tournamentId)).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('lets administrators view the roster while registration is open', async () => {
        jest.spyOn(service as any, 'getTournament').mockResolvedValue(tournament);
        jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
        const roster = await service.getTournamentRoster('session', tournament.tournamentId);
        expect(roster.teams.map((team) => team.registrationId)).toEqual(['member-a', 'rival-a']);
        expect(roster.teams.every((team) => !team.isOwnTeam)).toBe(true);
        expect(roster.canManageRoster).toBe(true);
      });

      it('lets an administrator replace a roster player only with an eligible uncommitted player', async () => {
        const updateEntity = jest.fn().mockResolvedValue(undefined);
        const registration = {
          ...registrations[1],
          etag: 'registration-version',
          MemberTshirtSize: 'M',
          PrintingExportedPlayers: '["rival-a","rival-b"]',
        };
        jest
          .spyOn(service as any, 'getMemberSession')
          .mockResolvedValue(memberSession('admin', 'Male', 'admin'));
        jest
          .spyOn(service as any, 'getTournamentRegistrationEntities')
          .mockResolvedValue(registrations);
        jest
          .spyOn(service as any, 'getTournamentRegistrationsTableClient')
          .mockReturnValue({
            getEntity: jest.fn().mockResolvedValue(registration),
            updateEntity,
          });
        jest.spyOn(service as any, 'getMembersTableClient').mockReturnValue({
          getEntity: jest.fn().mockImplementation((_partition: string, id: string) =>
            Promise.resolve({
              Status: 'Approved',
              Name: id === 'replacement' ? 'Replacement Player' : id === 'rival-a' ? 'Rita' : 'Rob',
              Gender: 'Male',
            })),
          listEntities: jest.fn().mockReturnValue((async function* () {
            yield { rowKey: 'replacement', Name: 'Replacement Player', Gender: 'Male' };
            yield { rowKey: 'ineligible', Name: 'Ineligible Player', Gender: 'Female' };
            yield { rowKey: 'member-a', Name: 'Already Registered', Gender: 'Male' };
          })()),
        });

        await expect(
          service.getTournamentRosterReplacementCandidates(
            'session',
            tournament.tournamentId,
            'rival-a',
            'rival-a',
            'player',
          ),
        ).resolves.toEqual([
          {
            memberId: 'replacement',
            name: 'Replacement Player',
            gender: 'Male',
            eligible: true,
          },
        ]);

        await expect(
          service.replaceTournamentRosterPlayer(
            'session',
            tournament.tournamentId,
            'rival-a',
            'rival-a',
            'replacement',
          ),
        ).resolves.toEqual({
          memberId: 'replacement',
          name: 'Replacement Player',
          gender: 'Male',
        });
        expect(updateEntity).toHaveBeenCalledWith(
          expect.objectContaining({
            MemberId: 'replacement',
            MemberName: 'Replacement Player',
            MemberTshirtSize: '',
            PrintingExportedPlayers: '["rival-b"]',
            RosterUpdatedBy: 'admin',
          }),
          'Merge',
          { etag: 'registration-version' },
        );
      });

      it('rejects an administrator replacement that violates the roster gender requirement', async () => {
        jest
          .spyOn(service as any, 'getMemberSession')
          .mockResolvedValue(memberSession('admin', 'Male', 'admin'));
        jest
          .spyOn(service as any, 'getTournamentRegistrationEntities')
          .mockResolvedValue(registrations);
        jest
          .spyOn(service as any, 'getTournamentRegistrationsTableClient')
          .mockReturnValue({
            getEntity: jest.fn().mockResolvedValue({
              ...registrations[1],
              etag: 'registration-version',
            }),
            updateEntity: jest.fn(),
          });
        jest.spyOn(service as any, 'getMembersTableClient').mockReturnValue({
          getEntity: jest.fn().mockImplementation((_partition: string, id: string) =>
            Promise.resolve({
              Status: 'Approved',
              Name: id === 'replacement' ? 'Replacement Player' : 'Rob',
              Gender: id === 'replacement' ? 'Female' : 'Male',
            })),
        });

        await expect(
          service.replaceTournamentRosterPlayer(
            'session',
            tournament.tournamentId,
            'rival-a',
            'rival-a',
            'replacement',
          ),
        ).rejects.toThrow('gender requirements');
      });
    });

    describe('filing protests', () => {
      it('uploads mandatory evidence and records an open protest', async () => {
        const result = await service.createTournamentProtest('session', tournament.tournamentId, protestInput, [
          evidence(), evidence({ originalname: 'photo.png', mimetype: 'image/png', buffer: png, size: png.length }),
        ]);
        expect(upload).toHaveBeenCalledTimes(2);
        expect(protestsTable.createEntity).toHaveBeenCalledWith(expect.objectContaining({
          partitionKey: tournament.tournamentId,
          ProtesterId: 'member-a',
          ProtestedMemberId: 'rival-a',
          ProtestedMemberName: 'Rita',
          ProtestedRegistrationId: 'rival-a',
          EligibilityCategory: 'Skill level eligibility',
          Status: 'Open',
        }));
        expect(result).toMatchObject({ protestedMemberName: 'Rita', status: 'Open' });
        expect(result.evidence).toEqual([
          expect.objectContaining({ fileName: 'evidence.pdf', url: expect.stringContaining('/evidence/0') }),
          expect.objectContaining({ fileName: 'photo.png', url: expect.stringContaining('/evidence/1') }),
        ]);
      });

      it.each<[string, Record<string, unknown>[] | undefined, Record<string, unknown>]>([
        ['missing evidence', undefined, {}],
        ['empty evidence', [], {}],
        ['too many files', Array.from({ length: 6 }, () => evidence()), {}],
        ['unsupported type', [evidence({ mimetype: 'text/plain' })], {}],
        ['mismatched content', [evidence({ mimetype: 'image/png' })], {}],
        ['oversized file', [evidence({ buffer: Buffer.alloc(10 * 1024 * 1024 + 1), size: 10 * 1024 * 1024 + 1 })], {}],
        ['short reason', [evidence()], { reason: 'Too short' }],
        ['unknown category', [evidence()], { eligibilityCategory: 'Other stuff' }],
        ['missing player', [evidence()], { protestedMemberId: '' }],
      ])('rejects %s', async (_label, files, overrides) => {
        await expect(service.createTournamentProtest('session', tournament.tournamentId, { ...protestInput, ...overrides } as any, files as any))
          .rejects.toBeInstanceOf(BadRequestException);
        expect(upload).not.toHaveBeenCalled();
        expect(protestsTable.createEntity).not.toHaveBeenCalled();
      });

      it.each(['member-a', 'member-b'])('rejects protests against own team member %s', async (protestedMemberId) => {
        await expect(service.createTournamentProtest('session', tournament.tournamentId, { ...protestInput, protestedMemberId }, [evidence()]))
          .rejects.toThrow('own team');
      });

      it('rejects protests against players who are not on the roster', async () => {
        await expect(service.createTournamentProtest('session', tournament.tournamentId, { ...protestInput, protestedMemberId: 'pending-a' }, [evidence()]))
          .rejects.toBeInstanceOf(NotFoundException);
      });

      it('rejects duplicate open protests against the same player', async () => {
        protestEntities = [{ partitionKey: tournament.tournamentId, rowKey: protestId, ProtesterId: 'member-a', ProtestedMemberId: 'rival-a', Status: 'Open' }];
        await expect(service.createTournamentProtest('session', tournament.tournamentId, protestInput, [evidence()]))
          .rejects.toBeInstanceOf(ConflictException);
        expect(upload).not.toHaveBeenCalled();
      });

      it('rejects protests while registration is open or from unconfirmed members', async () => {
        jest.spyOn(service as any, 'getTournament').mockResolvedValue(tournament);
        await expect(service.createTournamentProtest('session', tournament.tournamentId, protestInput, [evidence()]))
          .rejects.toBeInstanceOf(ConflictException);
        jest.spyOn(service as any, 'getTournament').mockResolvedValue(closedTournament);
        jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('pending-a'));
        await expect(service.createTournamentProtest('session', tournament.tournamentId, protestInput, [evidence()]))
          .rejects.toBeInstanceOf(ForbiddenException);
      });

      it('removes uploaded evidence when the protest cannot be saved', async () => {
        protestsTable.createEntity.mockRejectedValue(new Error('storage down'));
        await expect(service.createTournamentProtest('session', tournament.tournamentId, protestInput, [evidence()])).rejects.toBeDefined();
        expect(blob.deleteIfExists).toHaveBeenCalledTimes(1);
      });

      describe('when the protests table does not exist yet', () => {
        const tableNotFound = () => Object.assign(new Error('TableNotFound'), { statusCode: 404 });

        beforeEach(() => {
          protestsTable.listEntities.mockImplementation(() => (async function* () { throw tableNotFound(); })());
        });

        it('treats a missing table as having no protests', async () => {
          await expect(service.getMyTournamentProtests('session', tournament.tournamentId)).resolves.toEqual([]);
          jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
          await expect(service.getTournamentProtestsForAdmin('session')).resolves.toEqual([]);
        });

        it('creates the table when the first protest is filed', async () => {
          const createTable = jest.fn().mockResolvedValue(undefined);
          Object.assign(protestsTable, { createTable });
          protestsTable.createEntity.mockRejectedValueOnce(tableNotFound()).mockResolvedValueOnce(undefined);
          await expect(service.createTournamentProtest('session', tournament.tournamentId, protestInput, [evidence()]))
            .resolves.toMatchObject({ status: 'Open' });
          expect(createTable).toHaveBeenCalledTimes(1);
          expect(protestsTable.createEntity).toHaveBeenCalledTimes(2);
          expect(blob.deleteIfExists).not.toHaveBeenCalled();
        });
      });
    });

    describe('reviewing protests and evidence', () => {
      const storedProtest = () => ({
        partitionKey: tournament.tournamentId, rowKey: protestId, TournamentName: tournament.name,
        ProtesterId: 'member-a', ProtesterName: 'Alice', ProtestedMemberId: 'rival-a', ProtestedMemberName: 'Rita',
        EligibilityCategory: 'Skill level eligibility', Reason: protestInput.reason, Status: 'Open', CreatedAt: '2026-10-06T00:00:00.000Z',
        EvidenceFiles: JSON.stringify([{
          blobName: `tournament-protest-evidence/${tournament.tournamentId}/${protestId}/file.pdf`,
          fileName: 'evidence.pdf', contentType: 'application/pdf', size: pdf.length, uploadedAt: '2026-10-06T00:00:00.000Z',
        }]),
        etag: 'protest-version',
      });

      beforeEach(() => {
        protestsTable.getEntity.mockResolvedValue(storedProtest());
        jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('admin', 'Male', 'admin'));
      });

      it.each(['Upheld', 'Dismissed'] as const)('lets administrators mark an open protest %s', async (status) => {
        const result = await service.reviewTournamentProtest('session', tournament.tournamentId, protestId, status, '  Checked results ');
        expect(protestsTable.updateEntity).toHaveBeenCalledWith(
          expect.objectContaining({ Status: status, ReviewNote: 'Checked results' }), 'Merge', { etag: 'protest-version' },
        );
        expect(result).toMatchObject({ status, reviewNote: 'Checked results', reviewedAt: expect.any(String) });
      });

      it('rejects invalid review decisions and already reviewed protests', async () => {
        await expect(service.reviewTournamentProtest('session', tournament.tournamentId, protestId, 'Open'))
          .rejects.toBeInstanceOf(BadRequestException);
        protestsTable.getEntity.mockResolvedValue({ ...storedProtest(), Status: 'Dismissed' });
        await expect(service.reviewTournamentProtest('session', tournament.tournamentId, protestId, 'Upheld'))
          .rejects.toBeInstanceOf(ConflictException);
        expect(protestsTable.updateEntity).not.toHaveBeenCalled();
      });

      it('lists every protest for administrators with open protests first', async () => {
        protestEntities = [
          { ...storedProtest(), rowKey: 'reviewed', Status: 'Upheld', CreatedAt: '2026-10-07T00:00:00.000Z' },
          storedProtest(),
        ];
        const protests = await service.getTournamentProtestsForAdmin('session');
        expect(protests.map((protest) => protest.status)).toEqual(['Open', 'Upheld']);
        jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('member-a'));
        await expect(service.getTournamentProtestsForAdmin('session')).rejects.toBeInstanceOf(ForbiddenException);
      });

      it.each([['admin', 'admin'], ['member-a', 'member']])('serves evidence to %s', async (memberId, role) => {
        jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession(memberId, 'Male', role));
        await expect(service.getTournamentProtestEvidence('session', tournament.tournamentId, protestId, 0))
          .resolves.toEqual({ buffer: pdf, contentType: 'application/pdf', fileName: 'evidence.pdf' });
      });

      it('blocks evidence access for other players and unknown files', async () => {
        await expect(service.getTournamentProtestEvidence('session', tournament.tournamentId, protestId, 3))
          .rejects.toBeInstanceOf(NotFoundException);
        jest.spyOn(service as any, 'getMemberSession').mockResolvedValue(memberSession('rival-a'));
        await expect(service.getTournamentProtestEvidence('session', tournament.tournamentId, protestId, 0))
          .rejects.toBeInstanceOf(ForbiddenException);
        expect(blob.downloadToBuffer).not.toHaveBeenCalled();
      });
    });
  });
});