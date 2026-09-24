import {
  BadRequestException,
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
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AppService } from './app.service';
import type {
  DashboardAuthResult,
  ImportParticipantsResult,
  MemberRegistrationInput,
  MemberRegistrationResult,
  MemberSessionResult,
  MemberProfileImageUploadInput,
  MemberDirectoryEntry,
  MemberAccountDetails,
  MemberProfileUpdateInput,
  EmailVerificationRequestResult,
  EmailVerificationResult,
  MonthlyParticipationUploadConfig,
  MonthlyParticipationUploadResult,
  MonthlyParticipationSummaryResponse,
} from './app.service';
import { GameScore } from './queue.types';
import type { QueueSelectionMode, TeamMatchingMode } from './queue.types';

@Controller()
export class AppController {
  private readonly memberSessionCookieName = 'spaqueue_member_session';

  constructor(private readonly appService: AppService) {}

  @Post('dashboard-auth')
  validateDashboardPassword(
    @Body('password') password?: string,
  ): DashboardAuthResult {
    return this.appService.validateDashboardPassword(password ?? '');
  }

  @Post('members/register')
  @UseInterceptors(
    FileInterceptor('profileImage', {
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async registerMember(
    @Body() body: Record<string, unknown>,
    @UploadedFile() profileImage?: MemberProfileImageUploadInput,
  ): Promise<MemberRegistrationResult> {
    const member: MemberRegistrationInput = {
      name: String(body.name ?? ''),
      email: String(body.email ?? ''),
      contactNo: String(body.contactNo ?? ''),
      emergencyContact: String(body.emergencyContact ?? ''),
      age: Number(body.age),
      gender: String(body.gender ?? ''),
      duprId: String(body.duprId ?? ''),
      reClubId: String(body.reClubId ?? ''),
      profileImageUrl: String(body.profileImageUrl ?? ''),
      password: String(body.password ?? ''),
      skills: this.parseMemberSkills(body.skills),
    };

    return this.appService.registerMember(member, profileImage);
  }

  @Post('members/login')
  async loginMember(
    @Body('email') email = '',
    @Body('password') password = '',
    @Res({ passthrough: true }) response: Response,
  ): Promise<MemberSessionResult> {
    const login = await this.appService.loginMember(email, password);
    response.cookie(this.memberSessionCookieName, login.sessionToken, {
      httpOnly: true,
      maxAge: Math.max(0, Date.parse(login.expiresAt) - Date.now()),
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });

    return { authenticated: true, member: login.member };
  }

  @Get('members/session')
  getMemberSession(
    @Headers('cookie') cookieHeader = '',
  ): Promise<MemberSessionResult> {
    return this.appService.getMemberSession(
      this.readCookie(cookieHeader, this.memberSessionCookieName),
    );
  }

  @Get('members')
  async getMemberDirectory(
    @Headers('cookie') cookieHeader = '',
  ): Promise<MemberDirectoryEntry[]> {
    await this.appService.getMemberSession(
      this.readCookie(cookieHeader, this.memberSessionCookieName),
    );

    return this.appService.getMemberDirectory();
  }

  @Get('members/me')
  async getMyMemberAccount(
    @Headers('cookie') cookieHeader = '',
  ): Promise<MemberAccountDetails> {
    const session = await this.appService.getMemberSession(
      this.readCookie(cookieHeader, this.memberSessionCookieName),
    );

    return this.appService.getMemberAccount(session.member.memberId);
  }

  @Patch('members/me')
  @UseInterceptors(
    FileInterceptor('profileImage', {
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async updateMyMemberAccount(
    @Body() body: Record<string, unknown>,
    @UploadedFile() profileImage: MemberProfileImageUploadInput | undefined,
    @Headers('cookie') cookieHeader = '',
  ): Promise<MemberAccountDetails> {
    const session = await this.appService.getMemberSession(
      this.readCookie(cookieHeader, this.memberSessionCookieName),
    );
    const member: MemberProfileUpdateInput = {
      name: String(body.name ?? ''),
      contactNo: String(body.contactNo ?? ''),
      emergencyContact: String(body.emergencyContact ?? ''),
      age: Number(body.age),
      gender: String(body.gender ?? ''),
      duprId: String(body.duprId ?? ''),
      reClubId: String(body.reClubId ?? ''),
      skills: this.parseMemberSkills(body.skills),
    };

    return this.appService.updateMemberAccount(
      session.member.memberId,
      member,
      profileImage,
    );
  }

  @Post('members/email-verification/request')
  async requestEmailVerification(
    @Headers('cookie') cookieHeader = '',
  ): Promise<EmailVerificationRequestResult> {
    const session = await this.appService.getMemberSession(
      this.readCookie(cookieHeader, this.memberSessionCookieName),
    );

    return this.appService.requestEmailVerification(session.member.memberId);
  }

  @Post('members/email-verification/confirm')
  confirmEmailVerification(
    @Body('token') token = '',
  ): Promise<EmailVerificationResult> {
    return this.appService.confirmEmailVerification(token);
  }

  @Get('members/:memberId')
  async getMemberProfile(
    @Param('memberId') memberId: string,
    @Headers('cookie') cookieHeader = '',
  ): Promise<MemberSessionResult['member']> {
    await this.appService.getMemberSession(
      this.readCookie(cookieHeader, this.memberSessionCookieName),
    );

    return this.appService.getMemberProfile(memberId);
  }

  @Post('members/logout')
  async logoutMember(
    @Headers('cookie') cookieHeader = '',
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ authenticated: false }> {
    await this.appService.logoutMember(
      this.readCookie(cookieHeader, this.memberSessionCookieName),
    );
    response.clearCookie(this.memberSessionCookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });

    return { authenticated: false };
  }

  private readCookie(cookieHeader: string, name: string): string {
    const cookie = cookieHeader
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${name}=`));

    if (!cookie) {
      return '';
    }

    try {
      return decodeURIComponent(cookie.slice(name.length + 1));
    } catch {
      return '';
    }
  }

  private parseMemberSkills(value?: unknown): Record<string, number | null> {
    if (!value) {
      return {};
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, number | null>;
    }

    try {
      const skills: unknown = JSON.parse(String(value));

      if (typeof skills !== 'object' || skills === null || Array.isArray(skills)) {
        throw new Error('Invalid skills payload.');
      }

      return skills as Record<string, number | null>;
    } catch {
      throw new BadRequestException('Skill ratings must be valid JSON.');
    }
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
