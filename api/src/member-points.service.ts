import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DefaultAzureCredential } from '@azure/identity';
import { TableClient, type TransactionAction } from '@azure/data-tables';
import { createHash } from 'node:crypto';
import { AppService } from './app.service';
import { StoreService } from './store.service';
import { isMissingTableEntity } from './azure-table-errors';
import { normalizeRewardEmailList } from './reward-email-recipients';

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

  constructor(
    private readonly app: AppService,
    private readonly store: StoreService,
  ) {}

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
      if (isMissingTableEntity(error)) return null;
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
      const lifetime = Number(summary?.LifetimePoints ?? summary?.Balance ?? 0);
      if (
        !Number.isSafeInteger(balance) ||
        !Number.isSafeInteger(lifetime + award.points)
      )
        throw new BadRequestException(
          'The resulting points balance exceeds the supported whole-number range.',
        );
      try {
        await this.getTable().submitTransaction([
          [
            'create',
            {
              ...entity,
              EarnedStart: lifetime,
              EarnedEnd: lifetime + award.points,
            },
          ],
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
                {
                  partitionKey: memberId,
                  rowKey: 'balance',
                  Balance: balance,
                  LifetimePoints: lifetime + award.points,
                },
                'Merge',
                { etag: summary.etag },
              ]
            : [
                'create',
                {
                  partitionKey: memberId,
                  rowKey: 'balance',
                  Balance: balance,
                  LifetimePoints: lifetime + award.points,
                },
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
        tokens: Number(summary?.Tokens ?? 0),
        awards: page.done
          ? []
          : await this.usedAwards(
              page.value,
              memberId,
              Number(summary?.ConvertedPoints ?? 0),
            ),
        continuationToken: page.done
          ? null
          : (page.value.continuationToken ?? null),
      };
    } catch (error) {
      this.storageError(error);
    }
  }
  private async self(token: string) {
    const { member } = await this.app.getMemberSession(token);
    this.validateMemberId(member.memberId);
    const account = await this.app.getMemberAccount(member.memberId);
    const activeGold =
      !!account.goldMembershipExpiresOn &&
      account.goldMembershipExpiresOn >= new Date().toISOString().slice(0, 10);
    return { member, account, activeGold };
  }

  async wallet(token: string) {
    const { member, activeGold } = await this.self(token);
    const summary = await this.getOptional('balance', member.memberId);
    return {
      memberId: member.memberId,
      activeGold,
      points: Number(summary?.Balance ?? 0),
      tokens: Number(summary?.Tokens ?? 0),
      convertedPoints: Number(summary?.ConvertedPoints ?? 0),
      tokensSpent: Number(summary?.TokensSpent ?? 0),
    };
  }

  private async usedAwards(
    entities: Record<string, unknown>[],
    memberId: string,
    converted: number,
  ) {
    const legacyStarts = new Map<string, number>();
    if (
      converted > 0 &&
      entities.some((entity) => entity.EarnedStart === undefined)
    ) {
      const legacy: Record<string, unknown>[] = [];
      try {
        for await (const entity of this.getTable().listEntities({
          queryOptions: {
            filter: `PartitionKey eq '${memberId}' and RowKey ge 'award:' and RowKey lt 'award;'`,
          },
        })) {
          if (entity.EarnedStart === undefined) legacy.push(entity);
        }
      } catch (error) {
        this.storageError(error);
      }
      let start = 0;
      for (const entity of legacy.sort(
        (a, b) =>
          (typeof a.CreatedAt === 'string' ? a.CreatedAt : '').localeCompare(
            typeof b.CreatedAt === 'string' ? b.CreatedAt : '',
          ) || String(a.rowKey).localeCompare(String(b.rowKey)),
      )) {
        legacyStarts.set(String(entity.rowKey), start);
        start += Number(entity.Points);
      }
    }
    return entities.map((entity) => {
      const points = Number(entity.Points);
      const start = Number(
        entity.EarnedStart ?? legacyStarts.get(String(entity.rowKey)) ?? 0,
      );
      const convertedPoints = Math.max(0, Math.min(points, converted - start));
      return {
        ...this.toAward(entity),
        convertedPoints,
        used: convertedPoints === points,
      };
    });
  }

  private transactionView(entity: Record<string, unknown>) {
    return {
      transactionId: String(entity.rowKey),
      type: String(entity.Type),
      points: Number(entity.Points ?? 0),
      tokens: Number(entity.Tokens),
      itemName: typeof entity.ItemName === 'string' ? entity.ItemName : '',
      createdAt: String(entity.CreatedAt),
      memberEmailStatus:
        typeof entity.MemberEmailStatus === 'string'
          ? entity.MemberEmailStatus
          : '',
      merchantEmailStatus:
        typeof entity.MerchantEmailStatus === 'string'
          ? entity.MerchantEmailStatus
          : '',
    };
  }

  async myHistory(token: string, kind: string, continuation?: string) {
    const { member } = await this.self(token);
    if (
      !['award', 'conversion', 'redemption'].includes(kind) ||
      (continuation !== undefined &&
        (typeof continuation !== 'string' || continuation.length > 10_000))
    )
      throw new BadRequestException('Invalid history request.');
    try {
      const summary = await this.getOptional('balance', member.memberId);
      const page = await this.getTable()
        .listEntities<Record<string, unknown>>({
          queryOptions: {
            filter: `PartitionKey eq '${member.memberId}' and RowKey ge '${kind}:' and RowKey lt '${kind};'`,
          },
        })
        .byPage({ maxPageSize: 50, continuationToken: continuation })
        .next();
      const entities = page.done ? [] : page.value;
      return {
        records:
          kind === 'award'
            ? await this.usedAwards(
                entities,
                member.memberId,
                Number(summary?.ConvertedPoints ?? 0),
              )
            : entities.map((entity) => this.transactionView(entity)),
        continuationToken: page.done
          ? null
          : (page.value.continuationToken ?? null),
      };
    } catch (error) {
      this.storageError(error);
    }
  }

  async adminRedemptions(token: string, continuation?: string) {
    const { member } = await this.app.getMemberSession(token);
    if (member.role !== 'admin')
      throw new ForbiddenException('Only admins can view all redemptions.');
    if (
      continuation !== undefined &&
      (typeof continuation !== 'string' || continuation.length > 10_000)
    )
      throw new BadRequestException('Invalid redemption continuation token.');
    try {
      const page = await this.getTable()
        .listEntities<Record<string, unknown>>({
          queryOptions: {
            filter:
              "RowKey ge 'redemption:' and RowKey lt 'redemption;' and Type eq 'redemption'",
          },
        })
        .byPage({ maxPageSize: 50, continuationToken: continuation })
        .next();
      return {
        records: page.done
          ? []
          : page.value.map((entity) => ({
              ...this.transactionView(entity),
              memberId: String(entity.partitionKey),
              memberName: String(entity.MemberName),
              memberEmail: String(entity.MemberEmail),
              merchantEmail: String(entity.MerchantEmail),
              merchantCc: normalizeRewardEmailList(
                entity.MerchantCc,
                'Merchant CC',
              ),
              merchantBcc: normalizeRewardEmailList(
                entity.MerchantBcc,
                'Merchant BCC',
              ),
              itemId: String(entity.ItemId),
              imageUrl: String(entity.ImageUrl),
            })),
        continuationToken: page.done
          ? null
          : (page.value.continuationToken ?? null),
      };
    } catch (error) {
      this.storageError(error);
    }
  }

  private rewardInput(
    input: unknown,
  ): Record<string, unknown> & { requestId: string } {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('Transaction details are required.');
    const data = input as Record<string, unknown>;
    if (
      typeof data.requestId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        data.requestId,
      )
    )
      throw new BadRequestException(
        'A valid transaction request ID is required.',
      );
    return { ...data, requestId: data.requestId };
  }

  private positive(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
      throw new BadRequestException('Enter a positive whole-number amount.');
    return value;
  }

  async convert(token: string, input: unknown) {
    const data = this.rewardInput(input);
    const amount = this.positive(data.points);
    return this.transact(token, data.requestId, 'conversion', {
      points: amount,
    });
  }

  async redeem(token: string, input: unknown) {
    const data = this.rewardInput(input);
    if (typeof data.itemId !== 'string' || typeof data.version !== 'string')
      throw new BadRequestException('Choose a store item.');
    const result = await this.transact(token, data.requestId, 'redemption', {
      itemId: data.itemId,
      version: data.version,
    });
    await this.deliverEmails(token, result.transactionId, false);
    return this.redemptionStatus(token, result.transactionId);
  }

  private async transact(
    token: string,
    requestId: string,
    kind: 'conversion' | 'redemption',
    details: { points: number } | { itemId: string; version: string },
  ) {
    const { member, account, activeGold } = await this.self(token);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ kind, ...details }))
      .digest('hex');
    const requestKey = `wallet-request:${requestId}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const replay = await this.getOptional(requestKey, member.memberId);
      if (replay) {
        if (replay.Fingerprint !== fingerprint)
          throw new ConflictException(
            'This request ID was used for different transaction details.',
          );
        const existing = await this.getOptional(
          String(replay.TransactionId),
          member.memberId,
        );
        if (!existing)
          throw new ConflictException(
            'Transaction history is inconsistent. Contact an administrator.',
          );
        return this.transactionView(existing);
      }
      if (!activeGold)
        throw new ForbiddenException(
          'Active Gold membership is required to convert points or redeem tokens.',
        );
      const item =
        'itemId' in details ? await this.store.get(details.itemId) : null;
      if (
        item &&
        (!item.enabled ||
          ('version' in details && details.version !== item.version))
      )
        throw new ConflictException(
          'The store item changed or is disabled. Refresh the store before redeeming.',
        );
      if (
        item &&
        (!process.env.MAILGUN_API_KEY ||
          !process.env.MAILGUN_DOMAIN ||
          !process.env.EMAIL_FROM)
      )
        throw new BadRequestException(
          'Redemption email delivery is not configured.',
        );
      if (item && !account.email)
        throw new BadRequestException(
          'Your member email is required for redemption.',
        );
      const summary = await this.getOptional('balance', member.memberId);
      const points = Number(summary?.Balance ?? 0);
      const tokens = Number(summary?.Tokens ?? 0);
      const amount =
        'points' in details ? details.points : this.positive(item?.tokenCost);
      if ((kind === 'conversion' ? points : tokens) < amount)
        throw new BadRequestException(
          kind === 'conversion'
            ? 'Not enough available points.'
            : 'Not enough tokens.',
        );
      const converted = Number(summary?.ConvertedPoints ?? 0);
      const spent = Number(summary?.TokensSpent ?? 0);
      const updated = {
        partitionKey: member.memberId,
        rowKey: 'balance',
        Balance: kind === 'conversion' ? points - amount : points,
        Tokens: kind === 'conversion' ? tokens + amount : tokens - amount,
        ConvertedPoints: kind === 'conversion' ? converted + amount : converted,
        TokensSpent: kind === 'redemption' ? spent + amount : spent,
        LifetimePoints: Number(summary?.LifetimePoints ?? points),
      };
      if (
        Object.values(updated).some(
          (value) =>
            typeof value === 'number' &&
            (!Number.isSafeInteger(value) || value < 0),
        )
      )
        throw new BadRequestException(
          'The wallet balance exceeds the supported range.',
        );
      const transaction = {
        partitionKey: member.memberId,
        rowKey: `${kind}:${String(9_999_999_999_999 - Date.now()).padStart(13, '0')}:${requestId}`,
        Type: kind,
        Points: kind === 'conversion' ? amount : 0,
        Tokens: amount,
        CreatedAt: new Date().toISOString(),
        ...(item
          ? {
              ItemId: item.itemId,
              ItemName: item.name,
              ImageUrl: item.imageUrl,
              MemberName: member.name,
              MemberEmail: account.email,
              MerchantEmail: item.merchantEmail,
              MerchantCc: item.merchantCc,
              MerchantBcc: item.merchantBcc,
              MemberEmailStatus: 'pending',
              MerchantEmailStatus: 'pending',
            }
          : { PointRangeStart: converted, PointRangeEnd: converted + amount }),
      };
      const actions: TransactionAction[] = [
        ['create', transaction],
        [
          'create',
          {
            partitionKey: member.memberId,
            rowKey: requestKey,
            Fingerprint: fingerprint,
            TransactionId: transaction.rowKey,
          },
        ],
        summary
          ? ['update', updated, 'Merge', { etag: summary.etag }]
          : ['create', updated],
      ];
      try {
        await this.getTable().submitTransaction(actions);
        return this.transactionView(transaction);
      } catch (error) {
        if (![409, 412].includes(this.code(error) ?? 0))
          this.storageError(error);
      }
    }
    throw new ConflictException(
      'Your wallet changed concurrently. Retry the same request.',
    );
  }

  private async redemptionStatus(token: string, transactionId: string) {
    const { member } = await this.self(token);
    const entity = await this.getOptional(transactionId, member.memberId);
    if (!entity || entity.Type !== 'redemption')
      throw new BadRequestException('Redemption not found.');
    return this.transactionView(entity);
  }

  async retryEmails(token: string, transactionId: string, input: unknown) {
    if (
      !input ||
      typeof input !== 'object' ||
      !('confirmResend' in input) ||
      input.confirmResend !== true
    )
      throw new BadRequestException(
        'Confirm that retrying an unconfirmed email may send a duplicate notification.',
      );
    await this.deliverEmails(token, transactionId, true);
    return this.redemptionStatus(token, transactionId);
  }

  private async deliverEmails(
    token: string,
    transactionId: string,
    retry: boolean,
  ) {
    const { member } = await this.self(token);
    if (!/^redemption:\d{13}:[a-f0-9-]{36}$/i.test(transactionId))
      throw new BadRequestException('Invalid redemption reference.');
    for (const recipient of ['Member', 'Merchant'] as const) {
      const field = `${recipient}EmailStatus`;
      const row = await this.getOptional(transactionId, member.memberId);
      if (!row || row.Type !== 'redemption')
        throw new BadRequestException('Redemption not found.');
      const status = row[field];
      const timestamp = row[`${recipient}EmailAttemptAt`];
      const lastAttempt =
        typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
      if (
        status === 'accepted' ||
        (status === 'sending' && Date.now() - lastAttempt < 120_000) ||
        (status !== 'pending' && !retry)
      )
        continue;
      try {
        await this.getTable().updateEntity(
          {
            partitionKey: member.memberId,
            rowKey: transactionId,
            [field]: 'sending',
            [`${recipient}EmailAttemptAt`]: new Date().toISOString(),
          },
          'Merge',
          { etag: row.etag },
        );
      } catch (error) {
        if (this.code(error) === 412) continue;
        this.storageError(error);
      }
      let result = 'accepted';
      try {
        await this.app.sendRewardRedemptionEmail({
          email: String(row[`${recipient}Email`]),
          ...(recipient === 'Merchant'
            ? {
                cc: normalizeRewardEmailList(row.MerchantCc, 'Merchant CC'),
                bcc: normalizeRewardEmailList(row.MerchantBcc, 'Merchant BCC'),
              }
            : {}),
          memberName: String(row.MemberName),
          memberEmail: String(row.MemberEmail),
          itemName: String(row.ItemName),
          tokens: Number(row.Tokens),
          reference: transactionId,
          createdAt: String(row.CreatedAt),
        });
      } catch (error) {
        result = 'unconfirmed';
        this.logger.error(
          `Redemption ${transactionId} ${recipient} email delivery is unconfirmed.`,
          error,
        );
      }
      try {
        await this.getTable().updateEntity(
          {
            partitionKey: member.memberId,
            rowKey: transactionId,
            [field]: result,
          },
          'Merge',
        );
      } catch (error) {
        this.storageError(error);
      }
    }
  }
}
