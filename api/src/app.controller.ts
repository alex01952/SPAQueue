import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';
import type {
  DashboardAuthResult,
  ImportParticipantsResult,
  MemberRegistrationInput,
  MemberRegistrationResult,
  MonthlyParticipationUploadConfig,
  MonthlyParticipationUploadResult,
  MonthlyParticipationSummaryResponse,
} from './app.service';
import { GameScore } from './queue.types';
import type { QueueSelectionMode, TeamMatchingMode } from './queue.types';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('dashboard-auth')
  validateDashboardPassword(
    @Body('password') password?: string,
  ): DashboardAuthResult {
    return this.appService.validateDashboardPassword(password ?? '');
  }

  @Post('members/register')
  async registerMember(
    @Body() member: MemberRegistrationInput,
  ): Promise<MemberRegistrationResult> {
    return this.appService.registerMember(member);
  }

  @Get('participation/monthly')
  async getMonthlyParticipationSummary(): Promise<MonthlyParticipationSummaryResponse> {
    return this.appService.getMonthlyParticipationSummary();
  }

  @Get('participation/monthly/upload-config')
  getMonthlyParticipationUploadConfig(
    @Headers('x-dashboard-password') dashboardPassword = '',
  ): MonthlyParticipationUploadConfig {
    this.appService.validateDashboardPassword(dashboardPassword);

    return this.appService.getMonthlyParticipationUploadConfig();
  }

  @Post('participation/monthly/uploads')
  @UseInterceptors(
    FilesInterceptor('files', 25, {
      limits: {
        fileSize: 1024 * 1024,
      },
    }),
  )
  async uploadMonthlyParticipationFiles(
    @Body('month') month: string,
    @UploadedFiles()
    files: Array<{
      originalname: string;
      buffer: Buffer;
      mimetype?: string;
      size: number;
    }> = [],
    @Headers('x-dashboard-password') dashboardPassword = '',
  ): Promise<MonthlyParticipationUploadResult> {
    this.appService.validateDashboardPassword(dashboardPassword);

    return this.appService.uploadMonthlyParticipationFiles(month ?? '', files);
  }

  @Get('queue')
  getQueueSnapshot(
    @Query('courtCount', new DefaultValuePipe(1), ParseIntPipe)
    courtCount: number,
    @Query('selectionMode', new DefaultValuePipe('queue-line'))
    selectionMode: QueueSelectionMode,
    @Query('matchingMode', new DefaultValuePipe('dupr-balance'))
    matchingMode: TeamMatchingMode,
    @Headers('x-dashboard-password') dashboardPassword = '',
  ) {
    this.appService.validateDashboardPassword(dashboardPassword);

    return this.appService.getQueueSnapshot(
      courtCount,
      selectionMode,
      matchingMode,
    );
  }

  @Patch('players/:id/ready')
  updatePlayerReadyState(
    @Param('id', ParseIntPipe) id: number,
    @Body('isReady', ParseBoolPipe) isReady: boolean,
    @Headers('x-dashboard-password') dashboardPassword = '',
  ) {
    this.appService.validateDashboardPassword(dashboardPassword);

    return this.appService.updatePlayerReadyState(id, isReady);
  }

  @Post('games')
  createGame(
    @Body('playerIds') playerIds: number[],
    @Headers('x-dashboard-password') dashboardPassword = '',
  ) {
    this.appService.validateDashboardPassword(dashboardPassword);

    return this.appService.createGame(playerIds ?? []);
  }

  @Post('games/batch')
  createGames(
    @Body('gameAssignments')
    gameAssignments?: Array<{ courtNumber: number; playerIds: number[] }>,
    @Body('playerGroups') playerGroups?: number[][],
    @Headers('x-dashboard-password') dashboardPassword = '',
  ) {
    this.appService.validateDashboardPassword(dashboardPassword);

    const normalizedAssignments =
      gameAssignments ??
      (playerGroups ?? []).map((group, index) => ({
        courtNumber: index + 1,
        playerIds: group,
      }));

    return this.appService.createGames(normalizedAssignments);
  }

  @Post('queue/import-participants')
  async importParticipantsFromText(
    @Body('sourceText') sourceText?: string,
    @Headers('x-dashboard-password') dashboardPassword = '',
  ): Promise<ImportParticipantsResult> {
    this.appService.validateDashboardPassword(dashboardPassword);

    return this.appService.importParticipantsFromText(sourceText ?? '');
  }

  @Patch('games/:id/complete')
  completeGame(
    @Param('id', ParseIntPipe) id: number,
    @Body() score: Partial<GameScore>,
    @Headers('x-dashboard-password') dashboardPassword = '',
  ) {
    this.appService.validateDashboardPassword(dashboardPassword);

    return this.appService.completeGame(id, score);
  }
}
