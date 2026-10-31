import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DefaultAzureCredential } from '@azure/identity';
import { TableClient } from '@azure/data-tables';
import { createHash } from 'node:crypto';
import { AppService } from './app.service';

export type PointSource =
  | 'OpenPlayParticipation'
  | 'CourtRental'
  | 'CustomAward';

export interface PointAward {
  awardId: string;
  requestId: string;
  source: PointSource;
  activityDate: string;
  points: number;
  scheduleName: string;
  startHour: number | null;
  courtNumber: number | null;
  reason: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

@Injectable()
export class MemberPointsService {
  private readonly logger = new Logger(MemberPointsService.name);
  private table?: TableClient;

  constructor(private readonly app: AppService) {}

  private getTable() {
    if (!this.table) {
      const account = process.env.MEMBERS_AZURE_STORAGE_ACCOUNT;
      if (!account)
        throw new BadRequestException(
          'MEMBERS_AZURE_STORAGE_ACCOUNT is required for member points.',
        );
      this.table = new TableClient(
        `https://${account}.table.core.windows.net`,
        process.env.MEMBER_POINTS_AZURE_TABLE ?? 'MemberPoints',
        new DefaultAzureCredential(),
      );
    }
    return this.table;
  }

  private async requireStaff(token: string) {
    const session = await this.app.getMemberSession(token);
    if (!['admin', 'balance-staff'].includes(session.member.role)) {
      throw new ForbiddenException(
        'Only admins and balance staff can manage member points.',
      );
    }
    return session.member;
  }

  private configuredPoints(name: string): number | null {
    const value = process.env[name];
    if (value === undefined || value === '') return null;
    const points = Number(value);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(points)) {
      throw new BadRequestException(`${name} must be a positive whole number.`);
    }
    return points;
  }

  async config(token: string) {
    await this.requireStaff(token);
    return {
      openPlayPoints: this.configuredPoints('Open_Play_Point'),
      courtRentalPoints: this.configuredPoints('Court_Rental_Point'),
    };
  }

  private today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private validateMemberId(memberId: string) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(memberId)) {
      throw new BadRequestException('Invalid member identifier.');
    }
  }

  private validateInput(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Point award details are required.');
    }
    const data = input as Record<string, unknown>;
    if (
      typeof data.requestId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        data.requestId,
      )
    ) {
      throw new BadRequestException('A valid award request ID is required.');
    }
    if (
      !['OpenPlayParticipation', 'CourtRental', 'CustomAward'].includes(
        String(data.source),
      )
    ) {
      throw new BadRequestException(
        'Choose Open Play Participation, Court Rental, or Custom Award.',
      );
    }
    const source = data.source as PointSource;
    const date =
      typeof data.activityDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(data.activityDate)
        ? new Date(`${data.activityDate}T00:00:00Z`)
        : null;
    if (
      !date ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== data.activityDate ||
      data.activityDate > this.today()
    ) {
      throw new BadRequestException(
        'Enter a valid activity date today or earlier (Philippine time).',
      );
    }
    const activityDate = data.activityDate;
    let scheduleName = '';
    let startHour: number | null = null;
    let courtNumber: number | null = null;
    let reason = '';
    let points: number;
    if (source === 'OpenPlayParticipation') {
      if (
        typeof data.scheduleName !== 'string' ||
        !data.scheduleName.trim() ||
        data.scheduleName.trim().length > 200
      ) {
        throw new BadRequestException(
          'Enter an Open Play schedule name of 1 to 200 characters.',
        );
      }
      scheduleName = data.scheduleName.trim().replace(/\s+/g, ' ');
      const configured = this.configuredPoints('Open_Play_Point');
      if (configured === null)
        throw new BadRequestException('Open_Play_Point is not configured.');
      points = configured;
    } else if (source === 'CourtRental') {
      if (
        typeof data.startHour !== 'number' ||
        !Number.isInteger(data.startHour) ||
        data.startHour < 0 ||
        data.startHour > 23 ||
        typeof data.courtNumber !== 'number' ||
        !Number.isSafeInteger(data.courtNumber) ||
        data.courtNumber < 1
      ) {
        throw new BadRequestException(
          'Choose an hourly rental slot and a positive whole-number court number.',
        );
      }
      startHour = data.startHour;
      courtNumber = data.courtNumber;
      const configured = this.configuredPoints('Court_Rental_Point');
      if (configured === null)
        throw new BadRequestException('Court_Rental_Point is not configured.');
      points = configured;
    } else {
      if (
        typeof data.points !== 'number' ||
        !Number.isSafeInteger(data.points) ||
        data.points < 1
      ) {
        throw new BadRequestException(
          'Custom points must be a positive whole number.',
        );
      }
      if (
        typeof data.reason !== 'string' ||
        !data.reason.trim() ||
        data.reason.trim().length > 1000
      ) {
        throw new BadRequestException(
          'Enter a reason of 1 to 1,000 characters for the custom award.',
        );
      }
      points = data.points;
      reason = data.reason.trim();
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          source,
          activityDate,
          scheduleName,
          startHour,
          courtNumber,
          reason,
          customPoints: source === 'CustomAward' ? points : null,
        }),
      )
      .digest('hex');
    const activity =
      source === 'OpenPlayParticipation'
        ? [source, activityDate, scheduleName.toLowerCase()]
        : source === 'CourtRental'
          ? [source, activityDate, startHour, courtNumber]
          : [source, data.requestId];
    const reverseDate = String(
      99_999_999 - Number(activityDate.replace(/-/g, '')),
    ).padStart(8, '0');
    const awardId = `award:${reverseDate}:${createHash('sha256').update(JSON.stringify(activity)).digest('hex')}`;
    return {
      awardId,
      fingerprint,
      requestId: data.requestId,
      source,
      activityDate,
      scheduleName,
      startHour,
      courtNumber,
      reason,
      points,
    };
  }

  private code(error: unknown): number | undefined {
    return error && typeof error === 'object' && 'statusCode' in error
      ? Number(error.statusCode)
      : undefined;
  }

  private storageError(error: unknown): never {
    this.logger.error('Member points storage operation failed.', error);
    throw new BadGatewayException(
      'Unable to access MemberPoints storage. Check table configuration and permissions, then try again.',
    );
  }

  private async getOptional(rowKey: string, memberId: string) {
    try {
      return await this.getTable().getEntity<Record<string, unknown>>(
        memberId,
        rowKey,
      );
    } catch (error: unknown) {
      if (
        this.code(error) === 404 &&
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ResourceNotFound'
      )
        return null;
      this.storageError(error);
    }
  }

  private toAward(entity: Record<string, unknown>): PointAward {
    return {
      awardId: String(entity.rowKey),
      requestId: String(entity.RequestId),
      source: entity.Source as PointSource,
      activityDate: String(entity.ActivityDate),
      points: Number(entity.Points),
      scheduleName:
        typeof entity.ScheduleName === 'string' ? entity.ScheduleName : '',
      startHour: typeof entity.StartHour === 'number' ? entity.StartHour : null,
      courtNumber:
        typeof entity.CourtNumber === 'number' ? entity.CourtNumber : null,
      reason: typeof entity.Reason === 'string' ? entity.Reason : '',
      createdBy: String(entity.CreatedBy),
      createdByName: String(entity.CreatedByName),
      createdAt: String(entity.CreatedAt),
    };
  }

  async award(token: string, memberId: string, input: unknown) {
    const actor = await this.requireStaff(token);
    this.validateMemberId(memberId);
    const award = this.validateInput(input);
    const requestKey = `request:${award.requestId}`;
    const replay = await this.getOptional(requestKey, memberId);
    if (replay) {
      if (replay.Fingerprint !== award.fingerprint)
        throw new ConflictException(
          'This request ID was already used for a different award.',
        );
      const existing = await this.getOptional(String(replay.AwardId), memberId);
      if (!existing)
        throw new ConflictException(
          'Award history is inconsistent. Contact an administrator.',
        );
      return this.toAward(existing);
    }
    const member = await this.app.getMemberAccount(memberId);
    const expiry = member.goldMembershipExpiresOn;
    if (
      !expiry ||
      expiry < new Date().toISOString().slice(0, 10) ||
      expiry < award.activityDate
    ) {
      throw new BadRequestException(
        'Only members with an active Gold membership can receive points. The activity must be on or before their membership expiry.',
      );
    }
    const entity = {
      partitionKey: memberId,
      rowKey: award.awardId,
      TransactionType: 'Earn',
      Source: award.source,
      ActivityDate: award.activityDate,
      Points: award.points,
      ScheduleName: award.scheduleName,
      ...(award.startHour !== null
        ? { StartHour: award.startHour, CourtNumber: award.courtNumber }
        : {}),
      Reason: award.reason,
      RequestId: award.requestId,
      CreatedBy: actor.memberId,
      CreatedByName: actor.name,
      CreatedAt: new Date().toISOString(),
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      const summary = await this.getOptional('balance', memberId);
      const balance = Number(summary?.Balance ?? 0) + award.points;
      if (!Number.isSafeInteger(balance))
        throw new BadRequestException(
          'The resulting points balance exceeds the supported whole-number range.',
        );
      try {
        await this.getTable().submitTransaction([
          ['create', entity],
          [
            'create',
            {
              partitionKey: memberId,
              rowKey: requestKey,
              Fingerprint: award.fingerprint,
              AwardId: award.awardId,
            },
          ],
          summary
            ? [
                'update',
                { partitionKey: memberId, rowKey: 'balance', Balance: balance },
                'Merge',
                { etag: summary.etag },
              ]
            : [
                'create',
                { partitionKey: memberId, rowKey: 'balance', Balance: balance },
              ],
        ]);
        return this.toAward(entity);
      } catch (error) {
        if (![409, 412].includes(this.code(error) ?? 0))
          this.storageError(error);
        const recorded = await this.getOptional(requestKey, memberId);
        if (recorded) {
          if (recorded.Fingerprint !== award.fingerprint)
            throw new ConflictException(
              'This request ID was already used for a different award.',
            );
          const existing = await this.getOptional(
            String(recorded.AwardId),
            memberId,
          );
          if (!existing)
            throw new ConflictException(
              'Award history is inconsistent. Contact an administrator.',
            );
          return this.toAward(existing);
        }
        if (await this.getOptional(award.awardId, memberId)) {
          throw new ConflictException(
            'Points have already been awarded to this member for that activity.',
          );
        }
      }
    }
    throw new ConflictException(
      'Points were updated concurrently. Retry the same award request.',
    );
  }

  async history(token: string, memberId: string, continuation?: string) {
    await this.requireStaff(token);
    this.validateMemberId(memberId);
    if (
      continuation !== undefined &&
      (typeof continuation !== 'string' || continuation.length > 10_000)
    ) {
      throw new BadRequestException('Invalid history continuation token.');
    }
    const member = await this.app.getMemberAccount(memberId);
    const table = this.getTable();
    try {
      const summary = await this.getOptional('balance', memberId);
      const pages = table
        .listEntities<Record<string, unknown>>({
          queryOptions: {
            filter: `PartitionKey eq '${memberId}' and RowKey ge 'award:' and RowKey lt 'award;'`,
          },
        })
        .byPage({ maxPageSize: 50, continuationToken: continuation });
      const page = await pages.next();
      return {
        memberId,
        memberName: member.name,
        goldMembershipExpiresOn: member.goldMembershipExpiresOn ?? null,
        balance: Number(summary?.Balance ?? 0),
        awards: page.done
          ? []
          : page.value.map((entity) => this.toAward(entity)),
        continuationToken: page.done
          ? null
          : (page.value.continuationToken ?? null),
      };
    } catch (error) {
      this.storageError(error);
    }
  }
}
