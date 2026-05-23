import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AppService } from './app.service';
import { GameScore } from './queue.types';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('queue')
  getQueueSnapshot(
    @Query('courtCount', new DefaultValuePipe(1), ParseIntPipe) courtCount: number,
  ) {
    return this.appService.getQueueSnapshot(courtCount);
  }

  @Patch('players/:id/ready')
  updatePlayerReadyState(
    @Param('id', ParseIntPipe) id: number,
    @Body('isReady', ParseBoolPipe) isReady: boolean,
  ) {
    return this.appService.updatePlayerReadyState(id, isReady);
  }

  @Post('games')
  createGame(@Body('playerIds') playerIds: number[]) {
    return this.appService.createGame(playerIds ?? []);
  }

  @Post('games/batch')
  createGames(@Body('playerGroups') playerGroups: number[][]) {
    return this.appService.createGames(playerGroups ?? []);
  }

  @Patch('games/:id/complete')
  completeGame(
    @Param('id', ParseIntPipe) id: number,
    @Body() score: Partial<GameScore>,
  ) {
    return this.appService.completeGame(id, score);
  }
}
