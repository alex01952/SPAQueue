import {
  Body, Controller, Get, Header, Headers, Param, Patch, Post, Put, Query,
  StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GoldMembershipService, type GoldMembershipFile } from './gold-membership.service';

@Controller('gold-membership')
export class GoldMembershipController {
  constructor(private readonly gold: GoldMembershipService) {}

  private token(cookie: string) {
    const value = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('spaqueue_member_session='));
    return value ? value.slice('spaqueue_member_session='.length) : '';
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  state(@Headers('cookie') cookie = '') { return this.gold.state(this.token(cookie)); }

  @Post('applications')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('receipt', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  submit(@Headers('cookie') cookie = '', @Body('requestId') requestId: unknown, @UploadedFile() file?: GoldMembershipFile, @Body('paymentMethod') paymentMethod?: unknown) {
    return this.gold.submit(this.token(cookie), requestId, file, paymentMethod);
  }

  @Get('applications')
  @Header('Cache-Control', 'private, no-store')
  applications(@Headers('cookie') cookie = '', @Query('status') status?: string) {
    return this.gold.applications(this.token(cookie), status);
  }

  @Patch('applications/:memberId/:applicationId/approve')
  @Header('Cache-Control', 'private, no-store')
  approve(@Headers('cookie') cookie = '', @Param('memberId') memberId: string, @Param('applicationId') id: string) {
    return this.gold.review(this.token(cookie), memberId, id, 'Approved');
  }

  @Patch('applications/:memberId/:applicationId/decline')
  @Header('Cache-Control', 'private, no-store')
  decline(@Headers('cookie') cookie = '', @Param('memberId') memberId: string, @Param('applicationId') id: string, @Body('reason') reason: unknown) {
    return this.gold.review(this.token(cookie), memberId, id, 'Declined', reason);
  }

  @Get('applications/:memberId/:applicationId/receipt')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async receipt(@Headers('cookie') cookie = '', @Param('memberId') memberId: string, @Param('applicationId') id: string) {
    const file = await this.gold.receipt(this.token(cookie), memberId, id);
    return new StreamableFile(file.buffer, { type: file.contentType, disposition: 'inline' });
  }

  @Get('document')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async document(@Headers('cookie') cookie = '') {
    const file = await this.gold.document(this.token(cookie));
    return new StreamableFile(file.buffer, { type: file.contentType, disposition: 'inline' });
  }

  @Put('document')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('document', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadDocument(@Headers('cookie') cookie = '', @UploadedFile() file?: GoldMembershipFile) {
    return this.gold.uploadDocument(this.token(cookie), file);
  }
}
