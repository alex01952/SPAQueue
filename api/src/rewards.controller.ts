import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MemberPointsService } from './member-points.service';
import { StoreService, type StoreImage } from './store.service';

@Controller()
export class RewardsController {
  constructor(
    private readonly points: MemberPointsService,
    private readonly store: StoreService,
  ) {}

  private token(cookie: string) {
    return (
      cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('spaqueue_member_session='))
        ?.slice('spaqueue_member_session='.length) ?? ''
    );
  }

  @Get('my-rewards')
  @Header('Cache-Control', 'private, no-store')
  wallet(@Headers('cookie') cookie = '') {
    return this.points.wallet(this.token(cookie));
  }

  @Get('my-rewards/history')
  @Header('Cache-Control', 'private, no-store')
  history(
    @Headers('cookie') cookie = '',
    @Query('kind') kind = 'award',
    @Query('continuation') continuation?: string,
  ) {
    return this.points.myHistory(this.token(cookie), kind, continuation);
  }

  @Post('my-rewards/convert')
  @Header('Cache-Control', 'private, no-store')
  convert(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.points.convert(this.token(cookie), input);
  }

  @Post('my-rewards/redeem')
  @Header('Cache-Control', 'private, no-store')
  redeem(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.points.redeem(this.token(cookie), input);
  }

  @Post('my-rewards/redemptions/:transactionId/email')
  @Header('Cache-Control', 'private, no-store')
  retryEmails(
    @Param('transactionId') id: string,
    @Body() input: unknown,
    @Headers('cookie') cookie = '',
  ) {
    return this.points.retryEmails(this.token(cookie), id, input);
  }

  @Get('store')
  @Header('Cache-Control', 'private, no-store')
  catalog(@Headers('cookie') cookie = '') {
    return this.store.list(this.token(cookie));
  }

  @Get('admin/store')
  @Header('Cache-Control', 'private, no-store')
  adminCatalog(@Headers('cookie') cookie = '') {
    return this.store.list(this.token(cookie), true);
  }

  @Get('admin/redemptions')
  @Header('Cache-Control', 'private, no-store')
  adminRedemptions(
    @Headers('cookie') cookie = '',
    @Query('continuation') continuation?: string,
  ) {
    return this.points.adminRedemptions(this.token(cookie), continuation);
  }

  @Post('admin/store')
  @Header('Cache-Control', 'private, no-store')
  create(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.store.save(this.token(cookie), input);
  }

  @Patch('admin/store/:itemId')
  @Header('Cache-Control', 'private, no-store')
  update(
    @Param('itemId') id: string,
    @Body() input: unknown,
    @Headers('cookie') cookie = '',
  ) {
    return this.store.save(this.token(cookie), input, id);
  }

  @Post('admin/store-images')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  image(
    @UploadedFile() file: StoreImage | undefined,
    @Headers('cookie') cookie = '',
  ) {
    return this.store.uploadImage(this.token(cookie), file);
  }
}
