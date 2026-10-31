import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { MemberPointsService } from './member-points.service';

@Controller('member-points')
export class MemberPointsController {
  constructor(private readonly points: MemberPointsService) {}

  private token(cookie: string) {
    const value = cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('spaqueue_member_session='));
    return value ? value.slice('spaqueue_member_session='.length) : '';
  }

  @Get('config')
  @Header('Cache-Control', 'private, no-store')
  config(@Headers('cookie') cookie = '') {
    return this.points.config(this.token(cookie));
  }

  @Get(':memberId')
  @Header('Cache-Control', 'private, no-store')
  history(
    @Param('memberId') memberId: string,
    @Headers('cookie') cookie = '',
    @Query('continuation') continuation?: string,
  ) {
    return this.points.history(this.token(cookie), memberId, continuation);
  }

  @Post(':memberId')
  @Header('Cache-Control', 'private, no-store')
  award(
    @Param('memberId') memberId: string,
    @Body() input: unknown,
    @Headers('cookie') cookie = '',
  ) {
    return this.points.award(this.token(cookie), memberId, input);
  }
}
