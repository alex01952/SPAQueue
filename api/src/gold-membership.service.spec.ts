import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppService, type MemberRole } from './app.service';
import { GoldMembershipService, type GoldMembershipFile } from './gold-membership.service';

describe('Gold membership applications', () => {
  let service: GoldMembershipService;
  let actor: string;
  let role: MemberRole;
  let version: number;
  const id = '12345678-1234-4234-8234-123456789abc';
  const nextId = '22345678-1234-4234-8234-123456789abc';
  const rows = new Map<string, Record<string, unknown>>();
  const missing = () => Object.assign(new Error('Missing entity'), { statusCode: 404, code: 'ResourceNotFound' });
  const receipt: GoldMembershipFile = {
    originalname: 'receipt.pdf', mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nreceipt'), size: Buffer.byteLength('%PDF-1.7\nreceipt'),
  };
  const blob = { uploadData: jest.fn(), getProperties: jest.fn(), downloadToBuffer: jest.fn() };
  const container = { getProperties: jest.fn(), getBlockBlobClient: jest.fn() };
  const table = { getEntity: jest.fn(), updateEntity: jest.fn(), upsertEntity: jest.fn(), listEntities: jest.fn() };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T08:00:00Z'));
    actor = 'player';
    role = 'member';
    version = 1;
    rows.clear();
    rows.set('members|player', { rowKey: 'player', Name: 'Player One', ReclubId: 'Ace', Role: 'member', etag: '1' });
    rows.set('gold-membership-settings|document', { BlobName: `gold-membership/documents/${id}.pdf` });
    const app = new AppService();
    jest.spyOn(app, 'getMemberSession').mockImplementation(async () => ({
      authenticated: true, member: {
        memberId: actor, role, name: 'Actor', age: null, gender: '', duprId: '', reClubId: '',
        profileImageUrl: '', skills: {}, createdAt: '', emailValidated: true,
      },
    }));
    service = new GoldMembershipService(app);
    Object.defineProperty(service, 'table', { value: () => table });
    Object.defineProperty(service, 'container', { value: () => container });
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    container.getProperties.mockReset().mockResolvedValue({});
    container.getBlockBlobClient.mockReset().mockReturnValue(blob);
    blob.uploadData.mockReset().mockResolvedValue(undefined);
    blob.getProperties.mockReset().mockResolvedValue({ contentLength: receipt.size, etag: 'blob-version' });
    blob.downloadToBuffer.mockReset().mockResolvedValue(receipt.buffer);
    table.getEntity.mockReset().mockImplementation(async (partition: string, key: string) => {
      const row = rows.get(`${partition}|${key}`);
      if (!row) throw missing();
      return { ...row };
    });
    table.updateEntity.mockReset().mockImplementation(async (entity: Record<string, unknown>, _mode: string, options: { etag: string }) => {
      const key = `${entity.partitionKey}|${entity.rowKey}`;
      const row = rows.get(key);
      if (row?.etag !== options.etag) throw Object.assign(new Error('Changed'), { statusCode: 412 });
      rows.set(key, { ...row, ...entity, etag: String(++version) });
    });
    table.upsertEntity.mockReset().mockImplementation(async (entity: Record<string, unknown>) => {
      rows.set(`${entity.partitionKey}|${entity.rowKey}`, { ...entity });
    });
    table.listEntities.mockReset().mockImplementation(() => (async function* () {
      for (const [key, row] of rows) if (key.startsWith('members|')) yield { ...row };
    })());
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  it('submits privately, survives a repeated request, and prevents duplicate pending applications', async () => {
    const result = await service.submit('session', id, receipt);
    expect(result).toMatchObject({ id, status: 'Pending', memberId: 'player', receiptFileName: 'receipt.pdf' });
    expect(JSON.stringify(result)).not.toContain('receiptBlobName');
    expect(JSON.stringify(result)).not.toContain('gold-membership/receipts/');
    expect(await service.submit('session', id, receipt)).toEqual(result);
    await expect(service.submit('session', nextId, receipt)).rejects.toBeInstanceOf(ConflictException);
    expect(blob.uploadData).toHaveBeenCalledTimes(1);
    expect((await service.state('session')).activeGold).toBe(false);
    expect(rows.get('members|player')?.GoldMembershipExpiresOn).toBeUndefined();
  });

  it('approves and activates exactly once in the same ETag-guarded member update, preserving role', async () => {
    await service.submit('session', id, receipt);
    actor = 'admin';
    role = 'admin';
    const approved = await service.review('admin-session', 'player', id, 'Approved');
    expect(approved).toMatchObject({ status: 'Approved', expiresOn: '2027-11-25' });
    expect(rows.get('members|player')).toMatchObject({ GoldMembershipExpiresOn: '2027-11-25', Role: 'member' });
    expect(table.updateEntity).toHaveBeenLastCalledWith(expect.objectContaining({
      GoldMembershipExpiresOn: '2027-11-25', GoldMembershipApplication: expect.stringContaining('"status":"Approved"'),
    }), 'Merge', { etag: '2' });
    jest.setSystemTime(new Date('2026-12-01T00:00:00Z'));
    expect(await service.review('admin-session', 'player', id, 'Approved')).toEqual(approved);
    expect(table.updateEntity).toHaveBeenCalledTimes(2);
  });

  it('records counter payments without uploading a receipt and still requires admin approval', async () => {
    const submitted = await service.submit('session', id, undefined, 'arena-counter');
    expect(submitted).toMatchObject({ status: 'Pending', paymentMethod: 'arena-counter', receiptFileName: null });
    expect(await service.submit('session', id, undefined, 'arena-counter')).toEqual(submitted);
    await expect(service.submit('session', nextId, undefined, 'arena-counter')).rejects.toBeInstanceOf(ConflictException);
    expect((await service.state('session')).activeGold).toBe(false);
    await expect(service.receipt('session', 'player', id)).rejects.toBeInstanceOf(NotFoundException);
    expect(container.getProperties).not.toHaveBeenCalled();
    expect(blob.uploadData).not.toHaveBeenCalled();
    role = 'admin';
    expect(await service.applications('session', 'Pending')).toEqual([submitted]);
    expect(await service.review('session', 'player', id, 'Approved')).toMatchObject({
      paymentMethod: 'arena-counter', status: 'Approved', expiresOn: '2027-11-25',
    });
    expect((await service.state('session')).activeGold).toBe(true);
  });

  it('treats null Azure projections as members without applications while listing submitted applications', async () => {
    rows.get('members|player')!.GoldMembershipApplication = null;
    expect((await service.state('session')).application).toBeNull();
    role = 'admin';
    expect(await service.applications('session', 'Pending')).toEqual([]);
    role = 'member';
    const submitted = await service.submit('session', id, undefined, 'arena-counter');
    rows.set('members|not-applied', { rowKey: 'not-applied', GoldMembershipApplication: null });
    role = 'admin';
    expect(await service.applications('session', 'Pending')).toEqual([submitted]);
  });

  it('keeps existing stored receipt applications readable when payment method is absent', async () => {
    await service.submit('session', id, receipt);
    const row = rows.get('members|player')!;
    const stored: Record<string, unknown> = JSON.parse(String(row.GoldMembershipApplication));
    delete stored.paymentMethod;
    row.GoldMembershipApplication = JSON.stringify(stored);
    expect((await service.state('session')).application).toMatchObject({ paymentMethod: 'receipt', receiptFileName: 'receipt.pdf' });
    expect((await service.receipt('session', 'player', id)).buffer).toEqual(receipt.buffer);
  });

  it('rejects unknown payment methods and receipt attachments for counter payments', async () => {
    await expect(service.submit('session', id, undefined, 'cash')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.submit('session', id, receipt, 'arena-counter')).rejects.toBeInstanceOf(BadRequestException);
    expect(table.updateEntity).not.toHaveBeenCalled();
    expect(blob.uploadData).not.toHaveBeenCalled();
  });

  it('uses the existing leap-day calendar-year rule on approval', async () => {
    await service.submit('session', id, receipt);
    role = 'admin';
    jest.setSystemTime(new Date('2028-02-29T23:00:00Z'));
    expect((await service.review('session', 'player', id, 'Approved')).expiresOn).toBe('2029-02-28');
  });

  it('declines with a required reason, allows reapplication, and rejects stale application actions', async () => {
    await service.submit('session', id, receipt);
    role = 'admin';
    await expect(service.review('session', 'player', id, 'Declined', '  ')).rejects.toBeInstanceOf(BadRequestException);
    expect(await service.review('session', 'player', id, 'Declined', ' Receipt is unreadable. ')).toMatchObject({
      status: 'Declined', declineReason: 'Receipt is unreadable.',
    });
    role = 'member';
    expect((await service.state('session')).application?.declineReason).toBe('Receipt is unreadable.');
    await service.submit('session', nextId, receipt);
    role = 'admin';
    await expect(service.review('session', 'player', id, 'Approved')).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.applications('session', 'Pending'))[0].id).toBe(nextId);
  });

  it('does not overwrite Gold membership granted while the application is pending', async () => {
    await service.submit('session', id, receipt);
    rows.get('members|player')!.GoldMembershipExpiresOn = '2028-01-01';
    role = 'admin';
    await expect(service.review('session', 'player', id, 'Approved')).rejects.toBeInstanceOf(ConflictException);
    expect(rows.get('members|player')?.GoldMembershipExpiresOn).toBe('2028-01-01');
    role = 'member';
    await expect(service.submit('session', nextId, receipt)).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents simultaneous approve and decline decisions from both succeeding', async () => {
    await service.submit('session', id, receipt);
    role = 'admin';
    const outcomes = await Promise.allSettled([
      service.review('session', 'player', id, 'Approved'),
      service.review('session', 'player', id, 'Declined', 'Invalid receipt'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  });

  it.each<MemberRole>(['member', 'balance-staff', 'club-owner'])('denies %s admin access before storage', async (denied) => {
    role = denied;
    await expect(service.applications('session')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.uploadDocument('session', receipt)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.review('session', 'player', id, 'Approved')).rejects.toBeInstanceOf(ForbiddenException);
    expect(table.getEntity).not.toHaveBeenCalled();
    expect(blob.uploadData).not.toHaveBeenCalled();
  });

  it('only lets the applicant and admins view receipts, without public blob URLs', async () => {
    await service.submit('session', id, receipt);
    expect(await service.receipt('session', 'player', id)).toEqual({ buffer: receipt.buffer, contentType: 'application/pdf' });
    actor = 'other';
    await expect(service.receipt('session', 'player', id)).rejects.toBeInstanceOf(ForbiddenException);
    role = 'admin';
    expect((await service.receipt('session', 'player', id)).buffer).toEqual(receipt.buffer);
  });

  it('requires a configured benefits PDF and keeps both documents and receipts private', async () => {
    rows.delete('gold-membership-settings|document');
    expect((await service.state('session')).documentAvailable).toBe(false);
    await expect(service.submit('session', id, receipt)).rejects.toBeInstanceOf(ConflictException);
    role = 'admin';
    await service.uploadDocument('session', receipt);
    expect((await service.state('session')).documentAvailable).toBe(true);
    expect((await service.document('session')).contentType).toBe('application/pdf');
    container.getProperties.mockResolvedValue({ blobPublicAccess: 'blob' });
    await expect(service.uploadDocument('session', receipt)).rejects.toBeInstanceOf(BadGatewayException);
    await expect(service.document('session')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects missing, oversized and disguised receipts before uploading', async () => {
    await expect(service.submit('session', id)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.submit('session', id, { ...receipt, buffer: Buffer.from('<html>'), size: 6 })).rejects.toBeInstanceOf(BadRequestException);
    const buffer = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(service.submit('session', id, { ...receipt, buffer, size: buffer.length })).rejects.toBeInstanceOf(BadRequestException);
    expect(blob.uploadData).not.toHaveBeenCalled();
  });

  it('reports missing tables, corrupted records and write races explicitly', async () => {
    table.getEntity.mockRejectedValueOnce(Object.assign(new Error('Missing table'), { statusCode: 404, code: 'TableNotFound' }));
    await expect(service.state('session')).rejects.toBeInstanceOf(BadGatewayException);
    rows.get('members|player')!.GoldMembershipApplication = '{invalid';
    await expect(service.state('session')).rejects.toBeInstanceOf(BadGatewayException);
    role = 'admin';
    await expect(service.applications('session')).rejects.toBeInstanceOf(BadGatewayException);
    role = 'member';
    delete rows.get('members|player')!.GoldMembershipApplication;
    table.updateEntity.mockRejectedValueOnce(Object.assign(new Error('Changed'), { statusCode: 412 }));
    await expect(service.submit('session', id, receipt)).rejects.toBeInstanceOf(ConflictException);
    expect((await service.state('session')).application).toBeNull();
  });
});
