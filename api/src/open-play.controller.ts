import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, Post, Put, StreamableFile } from '@nestjs/common';
import { OpenPlayService } from './open-play.service';

@Controller('open-play')
export class OpenPlayController {
  constructor(private readonly openPlay: OpenPlayService) {}

  private token(cookie: string) {
    const value = cookie.split(';').map((part) => part.trim())
      .find((part) => part.startsWith('spaqueue_member_session='));
    return value ? value.slice('spaqueue_member_session='.length) : '';
  }

  @Get('members')
  @Header('Cache-Control', 'private, no-store')
  getMembers(@Headers('cookie') cookie = '') {
    return this.openPlay.getMembers(this.token(cookie));
  }

  @Get('import-presets')
  @Header('Cache-Control', 'private, no-store')
  getImportPresets(@Headers('cookie') cookie = '') {
    return this.openPlay.getImportPresets(this.token(cookie));
  }

  @Put('import-presets')
  saveImportPreset(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.openPlay.saveImportPreset(this.token(cookie), input);
  }

  @Delete('import-presets/:id')
  @HttpCode(204)
  deleteImportPreset(@Param('id') id: string, @Headers('cookie') cookie = '') {
    return this.openPlay.deleteImportPreset(this.token(cookie), id);
  }

  @Get('draft')
  @Header('Cache-Control', 'private, no-store')
  getDraft(@Headers('cookie') cookie = '') {
    return this.openPlay.getDraft(this.token(cookie));
  }

  @Get('board')
  @Header('Cache-Control', 'private, no-store')
  getBoard(@Headers('cookie') cookie = '') {
    return this.openPlay.getBoard(this.token(cookie));
  }

  @Get('leaderboard')
  @Header('Cache-Control', 'no-store')
  getLeaderboard() {
    return this.openPlay.getLeaderboard();
  }

  @Get('leaderboard/images/:period/:rank/:imageKey')
  @Header('Cache-Control', 'private, max-age=60')
  @Header('X-Content-Type-Options', 'nosniff')
  async getLeaderboardImage(@Param('period') period: string, @Param('rank') rank: string, @Param('imageKey') imageKey: string) {
    const image = await this.openPlay.getLeaderboardImage(period, rank, imageKey);
    return new StreamableFile(image.buffer, { type: image.contentType });
  }

  @Put('board-state')
  @Header('Cache-Control', 'private, no-store')
  publishBoardState(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.openPlay.publishBoardState(this.token(cookie), input);
  }

  @Post('session/start')
  @Header('Cache-Control', 'private, no-store')
  startSession(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.openPlay.startSession(this.token(cookie), input);
  }

  @Post('session/end')
  @Header('Cache-Control', 'private, no-store')
  endSession(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.openPlay.endSession(this.token(cookie), input);
  }

  @Put('session/awards')
  @Header('Cache-Control', 'private, no-store')
  saveAwardDecision(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.openPlay.saveAwardDecision(this.token(cookie), input);
  }

  @Put('session/awards/progress')
  @Header('Cache-Control', 'private, no-store')
  recordAwardProgress(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.openPlay.recordAwardProgress(this.token(cookie), input);
  }

  @Post('session/awards/complete')
  @Header('Cache-Control', 'private, no-store')
  completeAwardReview(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.openPlay.completeAwardReview(this.token(cookie), input);
  }

  @Post('session/archive')
  @Header('Cache-Control', 'private, no-store')
  archiveSession(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.openPlay.archiveSession(this.token(cookie), input);
  }

  @Put('draft')
  @Header('Cache-Control', 'private, no-store')
  saveDraft(@Body() input: unknown, @Headers('cookie') cookie = '') {
    return this.openPlay.saveDraft(this.token(cookie), input);
  }
}