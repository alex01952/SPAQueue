import {
  BadGatewayException, BadRequestException, ConflictException, ForbiddenException,
  HttpException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { DefaultAzureCredential } from '@azure/identity';
import { TableClient, type TableEntityResult } from '@azure/data-tables';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { randomUUID } from 'node:crypto';
import { AppService, type TournamentDocumentUploadInput } from './app.service';
import { isMissingTableEntity } from './azure-table-errors';
import { goldMembershipAnniversary, isGoldMembershipActive } from './gold-membership';

const maxFileSize = 10 * 1024 * 1024;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fileNamePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(pdf|jpg|png|webp)$/i;
type ApplicationStatus = 'Pending' | 'Approved' | 'Declined';
type PaymentMethod = 'receipt' | 'arena-counter';
type MemberEntity = TableEntityResult<Record<string, unknown>>;
export type GoldMembershipFile = TournamentDocumentUploadInput;

interface StoredApplication {
  id: string;
  status: ApplicationStatus;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  declineReason: string;
  expiresOn: string | null;
  paymentMethod: PaymentMethod;
  receiptBlobName: string | null;
  receiptContentType: string | null;
  receiptFileName: string | null;
}

export interface GoldMembershipApplication {
  id: string;
  memberId: string;
  name: string;
  reClubId: string;
  status: ApplicationStatus;
  submittedAt: string;
  reviewedAt: string | null;
  declineReason: string;
  expiresOn: string | null;
  paymentMethod: PaymentMethod;
  receiptFileName: string | null;
}

@Injectable()
export class GoldMembershipService {
  private readonly logger = new Logger(GoldMembershipService.name);
  private membersTable?: TableClient;
  private imageContainer?: ContainerClient;

  constructor(private readonly app: AppService) {}

  private table(): TableClient {
    if (!this.membersTable) {
      const account = process.env.MEMBERS_AZURE_STORAGE_ACCOUNT;
      const name = process.env.MEMBERS_AZURE_TABLE;
      if (!account || !name) throw new Error('Member storage is not configured.');
      this.membersTable = new TableClient(`https://${account}.table.core.windows.net`, name, new DefaultAzureCredential());
    }
    return this.membersTable;
  }

  private container(): ContainerClient {
    if (!this.imageContainer) {
      const account = process.env.OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT;
      const name = process.env.GOLD_MEMBERSHIP_AZURE_CONTAINER ?? 'spaprivate';
      if (!account || name === process.env.OP_PARTICIPATION_AZURE_CONTAINER) {
        throw new Error('A separate private Gold membership blob container is required.');
      }
      this.imageContainer = new BlobServiceClient(
        `https://${account}.blob.core.windows.net`, new DefaultAzureCredential(),
        { retryOptions: { maxTries: 1, tryTimeoutInMs: 30_000 } },
      ).getContainerClient(name);
    }
    return this.imageContainer;
  }

  private async privateContainer() {
    const container = this.container();
    const properties = await container.getProperties({ abortSignal: AbortSignal.timeout(30_000) });
    if (properties.blobPublicAccess) throw new Error('The Gold membership blob container must not allow anonymous access.');
    return container;
  }

  private failure(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    this.logger.error('Gold membership storage operation failed.', error);
    return new BadGatewayException('Unable to complete the Gold membership request. Refresh before retrying.');
  }

  private async admin(token: string) {
    const session = await this.app.getMemberSession(token);
    if (session.member.role !== 'admin') throw new ForbiddenException('Only admins can review Gold applications.');
    return session.member;
  }

  private async member(memberId: string): Promise<MemberEntity> {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(memberId)) throw new BadRequestException('Invalid member identifier.');
    try {
      return await this.table().getEntity('members', memberId);
    } catch (error) {
      if (isMissingTableEntity(error)) throw new NotFoundException('Member account was not found.');
      throw error;
    }
  }

  private readApplication(entity: Record<string, unknown>): StoredApplication | null {
    if (entity.GoldMembershipApplication === undefined || entity.GoldMembershipApplication === null || entity.GoldMembershipApplication === '') return null;
    const value: unknown = JSON.parse(String(entity.GoldMembershipApplication));
    if (!value || typeof value !== 'object') throw new Error('Invalid stored Gold application.');
    const item = value as Record<string, unknown>;
    const paymentMethod = item.paymentMethod === undefined ? 'receipt' : item.paymentMethod;
    if (typeof item.id !== 'string' || !uuidPattern.test(item.id) ||
      !['Pending', 'Approved', 'Declined'].includes(String(item.status)) ||
      typeof item.submittedAt !== 'string' || !Number.isFinite(Date.parse(item.submittedAt)) ||
      (item.reviewedAt !== null && (typeof item.reviewedAt !== 'string' || !Number.isFinite(Date.parse(item.reviewedAt)))) ||
      (item.reviewedBy !== null && typeof item.reviewedBy !== 'string') ||
      typeof item.declineReason !== 'string' || (item.expiresOn !== null && typeof item.expiresOn !== 'string') ||
      (paymentMethod !== 'receipt' && paymentMethod !== 'arena-counter')) throw new Error('Invalid stored Gold application.');
    if (paymentMethod === 'receipt'
      ? typeof item.receiptBlobName !== 'string' || !item.receiptBlobName.startsWith(`gold-membership/receipts/${item.id}/`) ||
        !fileNamePattern.test(item.receiptBlobName.slice(`gold-membership/receipts/${item.id}/`.length)) ||
        !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(String(item.receiptContentType)) ||
        typeof item.receiptFileName !== 'string'
      : item.receiptBlobName !== null || item.receiptContentType !== null || item.receiptFileName !== null) {
      throw new Error('Invalid stored Gold application.');
    }
    return {
      id: item.id, status: item.status as ApplicationStatus, submittedAt: item.submittedAt,
      reviewedAt: item.reviewedAt as string | null, reviewedBy: item.reviewedBy as string | null,
      declineReason: item.declineReason, expiresOn: item.expiresOn as string | null,
      paymentMethod, receiptBlobName: item.receiptBlobName as string | null,
      receiptContentType: item.receiptContentType as string | null, receiptFileName: item.receiptFileName as string | null,
    };
  }

  private publicApplication(memberId: string, entity: Record<string, unknown>, item: StoredApplication): GoldMembershipApplication {
    return {
      memberId, name: String(entity.Name ?? ''), reClubId: String(entity.ReclubId ?? ''),
      id: item.id, status: item.status, submittedAt: item.submittedAt, reviewedAt: item.reviewedAt,
      declineReason: item.declineReason, expiresOn: item.expiresOn, paymentMethod: item.paymentMethod, receiptFileName: item.receiptFileName,
    };
  }

  private async documentRecord(): Promise<Record<string, unknown> | null> {
    try {
      const entity = await this.table().getEntity<Record<string, unknown>>('gold-membership-settings', 'document');
      if (typeof entity.BlobName !== 'string' || !entity.BlobName.startsWith('gold-membership/documents/') ||
        !fileNamePattern.test(entity.BlobName.slice('gold-membership/documents/'.length)) || !entity.BlobName.endsWith('.pdf')) {
        throw new Error('Invalid Gold membership document location.');
      }
      return entity;
    } catch (error) {
      if (isMissingTableEntity(error)) return null;
      throw error;
    }
  }

  async state(token: string) {
    const session = await this.app.getMemberSession(token);
    try {
      const [member, document] = await Promise.all([this.member(session.member.memberId), this.documentRecord()]);
      const application = this.readApplication(member);
      const goldMembershipExpiresOn = String(member.GoldMembershipExpiresOn ?? '') || null;
      return {
        activeGold: isGoldMembershipActive(goldMembershipExpiresOn), goldMembershipExpiresOn,
        documentAvailable: !!document,
        application: application ? this.publicApplication(session.member.memberId, member, application) : null,
      };
    } catch (error) { throw this.failure(error); }
  }

  private validateFile(file: GoldMembershipFile | undefined, pdfOnly = false) {
    if (!file || !file.buffer || file.size !== file.buffer.length || !file.size || file.size > maxFileSize) {
      throw new BadRequestException('Upload a file no larger than 10 MB.');
    }
    const type = (file.mimetype ?? '').toLowerCase();
    const data = file.buffer;
    const extension = type === 'application/pdf' && data.subarray(0, 5).toString() === '%PDF-' ? 'pdf'
      : !pdfOnly && type === 'image/jpeg' && data.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpg'
        : !pdfOnly && type === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
          : !pdfOnly && type === 'image/webp' && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
    if (!extension) throw new BadRequestException(pdfOnly ? 'Upload a valid PDF document.' : 'Upload a valid PDF, JPEG, PNG or WebP receipt.');
    return { file, extension, contentType: type };
  }

  async uploadDocument(token: string, file?: GoldMembershipFile) {
    await this.admin(token);
    const upload = this.validateFile(file, true);
    try {
      const container = await this.privateContainer();
      const blobName = `gold-membership/documents/${randomUUID()}.pdf`;
      await container.getBlockBlobClient(blobName).uploadData(upload.file.buffer, {
        blobHTTPHeaders: { blobContentType: upload.contentType }, abortSignal: AbortSignal.timeout(30_000),
      });
      await this.table().upsertEntity({
        partitionKey: 'gold-membership-settings', rowKey: 'document', BlobName: blobName,
        FileName: upload.file.originalname.slice(0, 200), UpdatedAt: new Date().toISOString(),
      }, 'Replace');
      return { documentAvailable: true };
    } catch (error) { throw this.failure(error); }
  }

  private async download(blobName: string, contentType: string) {
    const blob = (await this.privateContainer()).getBlockBlobClient(blobName);
    try {
      const properties = await blob.getProperties({ abortSignal: AbortSignal.timeout(30_000) });
      const length = properties.contentLength;
      if (typeof length !== 'number' || length < 1 || length > maxFileSize || !properties.etag) throw new Error('Invalid stored file size or ETag.');
      return {
        buffer: await blob.downloadToBuffer(0, length, { conditions: { ifMatch: properties.etag }, abortSignal: AbortSignal.timeout(30_000) }),
        contentType,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'BlobNotFound') {
        this.logger.warn('A Gold membership file was not found.');
        throw new NotFoundException('The file was not found.');
      }
      throw error;
    }
  }

  async document(token: string) {
    await this.app.getMemberSession(token);
    try {
      const record = await this.documentRecord();
      if (!record) throw new NotFoundException('The benefits and rate document has not been uploaded yet.');
      return await this.download(String(record.BlobName), 'application/pdf');
    } catch (error) { throw this.failure(error); }
  }

  async submit(token: string, requestId: unknown, file?: GoldMembershipFile, paymentMethod: unknown = 'receipt') {
    const session = await this.app.getMemberSession(token);
    if (typeof requestId !== 'string' || !uuidPattern.test(requestId)) throw new BadRequestException('A valid application request ID is required.');
    if (paymentMethod !== 'receipt' && paymentMethod !== 'arena-counter') throw new BadRequestException('Choose a valid payment method.');
    if (paymentMethod === 'arena-counter' && file) throw new BadRequestException('Do not attach a receipt when selecting Paid at arena counter.');
    const upload = paymentMethod === 'receipt' ? this.validateFile(file) : null;
    try {
      const member = await this.member(session.member.memberId);
      const existing = this.readApplication(member);
      if (existing?.id === requestId) return this.publicApplication(session.member.memberId, member, existing);
      if (isGoldMembershipActive(String(member.GoldMembershipExpiresOn ?? '') || null)) {
        throw new ConflictException('You already have active Gold membership.');
      }
      if (existing?.status === 'Pending') throw new ConflictException('Your Gold membership application is already awaiting review.');
      if (!(await this.documentRecord())) throw new ConflictException('The benefits and rate document is not available yet.');
      if (!member.etag) throw new Error('Member entity is missing an ETag.');
      let receiptBlobName: string | null = null;
      if (upload) {
        const container = await this.privateContainer();
        receiptBlobName = `gold-membership/receipts/${requestId}/${randomUUID()}.${upload.extension}`;
        await container.getBlockBlobClient(receiptBlobName).uploadData(upload.file.buffer, {
          blobHTTPHeaders: { blobContentType: upload.contentType }, abortSignal: AbortSignal.timeout(30_000),
        });
      }
      const application: StoredApplication = {
        id: requestId, status: 'Pending', submittedAt: new Date().toISOString(),
        reviewedAt: null, reviewedBy: null, declineReason: '', expiresOn: null,
        paymentMethod, receiptBlobName, receiptContentType: upload?.contentType ?? null,
        receiptFileName: upload?.file.originalname.slice(0, 200) ?? null,
      };
      await this.table().updateEntity({
        partitionKey: 'members', rowKey: session.member.memberId, GoldMembershipApplication: JSON.stringify(application),
      }, 'Merge', { etag: member.etag });
      return this.publicApplication(session.member.memberId, member, application);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 412) {
        throw new ConflictException('Your account changed. Refresh the application before retrying.');
      }
      throw this.failure(error);
    }
  }

  async applications(token: string, status?: string) {
    await this.admin(token);
    if (status && !['all', 'Pending', 'Approved', 'Declined'].includes(status)) throw new BadRequestException('Invalid application status.');
    try {
      const records: GoldMembershipApplication[] = [];
      const entities = this.table().listEntities<Record<string, unknown>>({
        queryOptions: { filter: "PartitionKey eq 'members'", select: ['RowKey', 'Name', 'ReclubId', 'GoldMembershipApplication'] },
      });
      for await (const entity of entities) {
        const application = this.readApplication(entity);
        if (application && (!status || status === 'all' || application.status === status)) {
          if (!entity.rowKey) throw new Error('Gold application is missing its member identifier.');
          records.push(this.publicApplication(entity.rowKey, entity, application));
        }
      }
      return records.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    } catch (error) { throw this.failure(error); }
  }

  async receipt(token: string, memberId: string, applicationId: string) {
    const session = await this.app.getMemberSession(token);
    if (session.member.role !== 'admin' && session.member.memberId !== memberId) throw new ForbiddenException('You cannot view this receipt.');
    try {
      const member = await this.member(memberId);
      const application = this.readApplication(member);
      if (!application || application.id !== applicationId) throw new NotFoundException('Application was not found.');
      if (!application.receiptBlobName || !application.receiptContentType) throw new NotFoundException('This application was paid at the arena counter and has no receipt.');
      return await this.download(application.receiptBlobName, application.receiptContentType);
    } catch (error) { throw this.failure(error); }
  }

  async review(token: string, memberId: string, applicationId: string, decision: 'Approved' | 'Declined', reason?: unknown) {
    const admin = await this.admin(token);
    if (decision === 'Declined' && (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000)) {
      throw new BadRequestException('Enter a decline reason of 1 to 1,000 characters.');
    }
    try {
      const member = await this.member(memberId);
      const application = this.readApplication(member);
      if (!application || application.id !== applicationId) throw new NotFoundException('Application was not found. Refresh the list.');
      if (application.status === decision) return this.publicApplication(memberId, member, application);
      if (application.status !== 'Pending') throw new ConflictException('This application has already been reviewed.');
      if (decision === 'Approved' && isGoldMembershipActive(String(member.GoldMembershipExpiresOn ?? '') || null)) {
        throw new ConflictException('This member already has active Gold membership. Refresh their profile before reviewing.');
      }
      if (!member.etag) throw new Error('Member entity is missing an ETag.');
      const reviewed: StoredApplication = {
        ...application, status: decision, reviewedAt: new Date().toISOString(), reviewedBy: admin.memberId,
        declineReason: decision === 'Declined' ? String(reason).trim() : '',
        expiresOn: decision === 'Approved' ? goldMembershipAnniversary() : null,
      };
      await this.table().updateEntity({
        partitionKey: 'members', rowKey: memberId, GoldMembershipApplication: JSON.stringify(reviewed),
        ...(decision === 'Approved' ? { GoldMembershipExpiresOn: reviewed.expiresOn } : {}),
      }, 'Merge', { etag: member.etag });
      return this.publicApplication(memberId, member, reviewed);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 412) {
        throw new ConflictException('The member or application changed. Refresh before reviewing again.');
      }
      throw this.failure(error);
    }
  }
}
