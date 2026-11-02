import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { randomUUID } from 'node:crypto';
import { AppService } from './app.service';
import { isMissingTableEntity } from './azure-table-errors';
import { normalizeRewardEmailList } from './reward-email-recipients';

export interface StoreImage {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

export interface StoreItem {
  itemId: string;
  name: string;
  imageUrl: string;
  merchantEmail: string;
  merchantCc: string;
  merchantBcc: string;
  tokenCost: number;
  enabled: boolean;
  version: string;
}

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);
  private table?: TableClient;

  constructor(private readonly app: AppService) {}

  private getTable() {
    const account = process.env.MEMBERS_AZURE_STORAGE_ACCOUNT;
    if (!account)
      throw new BadRequestException('Storage account is not configured.');
    return (this.table ??= new TableClient(
      `https://${account}.table.core.windows.net`,
      process.env.STORE_AZURE_TABLE ?? 'Store',
      new DefaultAzureCredential(),
    ));
  }

  private fail(error: unknown): never {
    this.logger.error('Store storage operation failed.', error);
    throw new BadGatewayException(
      'Unable to access the Store table. Check configuration and permissions.',
    );
  }

  private async admin(token: string) {
    const { member } = await this.app.getMemberSession(token);
    if (member.role !== 'admin')
      throw new ForbiddenException('Only admins can manage store items.');
    return member;
  }

  private item(entity: Record<string, unknown>): StoreItem {
    return {
      itemId: String(entity.rowKey),
      name: String(entity.Name),
      imageUrl: String(entity.ImageUrl),
      merchantEmail: String(entity.MerchantEmail),
      merchantCc: normalizeRewardEmailList(entity.MerchantCc, 'Merchant CC'),
      merchantBcc: normalizeRewardEmailList(entity.MerchantBcc, 'Merchant BCC'),
      tokenCost: Number(entity.TokenCost),
      enabled: entity.Enabled === true,
      version: String(entity.etag),
    };
  }

  async list(token: string, admin = false) {
    if (admin) await this.admin(token);
    else await this.app.getMemberSession(token);
    try {
      const items: StoreItem[] = [];
      for await (const entity of this.getTable().listEntities({
        queryOptions: {
          filter: `PartitionKey eq 'items'${admin ? '' : ' and Enabled eq true'}`,
        },
      })) {
        items.push(this.item(entity));
      }
      return items
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) =>
          admin
            ? item
            : { ...item, merchantEmail: '', merchantCc: '', merchantBcc: '' },
        );
    } catch (error) {
      this.fail(error);
    }
  }

  async get(itemId: string): Promise<StoreItem> {
    if (!/^[a-f0-9-]{36}$/i.test(itemId))
      throw new BadRequestException('Invalid store item.');
    try {
      return this.item(await this.getTable().getEntity('items', itemId));
    } catch (error) {
      if (isMissingTableEntity(error))
        throw new NotFoundException('Store item is unavailable.');
      this.fail(error);
    }
  }

  async save(token: string, input: unknown, itemId?: string) {
    const actor = await this.admin(token);
    if (!input || typeof input !== 'object')
      throw new BadRequestException('Item details are required.');
    const data = input as Record<string, unknown>;
    if (
      typeof data.name !== 'string' ||
      !data.name.trim() ||
      data.name.trim().length > 150 ||
      !Number.isSafeInteger(data.tokenCost) ||
      Number(data.tokenCost) < 1 ||
      typeof data.enabled !== 'boolean'
    )
      throw new BadRequestException(
        'Provide a name (up to 150 characters), positive whole-number token cost and enabled setting.',
      );
    const merchantEmail = normalizeRewardEmailList(
      data.merchantEmail,
      'Merchant To',
      true,
    );
    const merchantCc = normalizeRewardEmailList(data.merchantCc, 'Merchant CC');
    const merchantBcc = normalizeRewardEmailList(
      data.merchantBcc,
      'Merchant BCC',
    );
    const account = process.env.OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT;
    const container = process.env.OP_PARTICIPATION_AZURE_CONTAINER;
    const prefix = `https://${account}.blob.core.windows.net/${container}/store-images/`;
    if (
      typeof data.imageUrl !== 'string' ||
      !data.imageUrl.startsWith(prefix) ||
      !/^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(
        data.imageUrl.slice(prefix.length),
      )
    )
      throw new BadRequestException('Upload an item image before saving.');
    if (itemId) {
      const current = await this.get(itemId);
      if (data.version !== current.version)
        throw new ConflictException('This item changed. Reload before saving.');
    }
    const entity = {
      partitionKey: 'items',
      rowKey: itemId ?? randomUUID(),
      Name: data.name.trim(),
      ImageUrl: data.imageUrl,
      MerchantEmail: merchantEmail,
      MerchantCc: merchantCc,
      MerchantBcc: merchantBcc,
      TokenCost: Number(data.tokenCost),
      Enabled: data.enabled,
      UpdatedBy: actor.memberId,
      UpdatedAt: new Date().toISOString(),
    };
    try {
      if (itemId)
        await this.getTable().updateEntity(entity, 'Replace', {
          etag: String(data.version),
        });
      else await this.getTable().createEntity(entity);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'statusCode' in error &&
        [409, 412].includes(Number(error.statusCode))
      )
        throw new ConflictException('This item changed. Reload before saving.');
      this.fail(error);
    }
    return this.get(entity.rowKey);
  }

  async uploadImage(token: string, file?: StoreImage) {
    await this.admin(token);
    if (!file || !file.size || file.size > 5 * 1024 * 1024)
      throw new BadRequestException('Choose an image up to 5 MB.');
    const types: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const extension = types[file.mimetype];
    const buffer = file.buffer;
    const valid =
      (extension === 'png' &&
        buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
      (extension === 'jpg' &&
        buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) ||
      (extension === 'gif' &&
        /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString())) ||
      (extension === 'webp' &&
        buffer.subarray(0, 4).toString() === 'RIFF' &&
        buffer.subarray(8, 12).toString() === 'WEBP');
    if (!valid)
      throw new BadRequestException(
        'Upload a valid PNG, JPEG, GIF, or WebP image.',
      );
    const account = process.env.OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT;
    const container = process.env.OP_PARTICIPATION_AZURE_CONTAINER;
    if (!account || !container)
      throw new BadRequestException('Blob storage is not configured.');
    const blob = new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    )
      .getContainerClient(container)
      .getBlockBlobClient(`store-images/${randomUUID()}.${extension}`);
    try {
      await blob.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype },
      });
      return { imageUrl: blob.url };
    } catch (error) {
      this.logger.error('Store image upload failed.', error);
      throw new BadGatewayException('Unable to upload the item image.');
    }
  }
}
