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
import type { QueueSelectionMode, TeamMatchingMode } from './queue.types';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('queue')
  getQueueSnapshot(
    @Query('courtCount', new DefaultValuePipe(1), ParseIntPipe) courtCount: number,
    @Query('selectionMode', new DefaultValuePipe('queue-line')) selectionMode: QueueSelectionMode,
    @Query('matchingMode', new DefaultValuePipe('dupr-balance')) matchingMode: TeamMatchingMode,
  ) {
    return this.appService.getQueueSnapshot(courtCount, selectionMode, matchingMode);
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
  createGames(@Body('gameAssignments') gameAssignments?: Array<{ courtNumber: number; playerIds: number[] }>, @Body('playerGroups') playerGroups?: number[][]) {
    const normalizedAssignments = gameAssignments ??
      (playerGroups ?? []).map((group, index) => ({ courtNumber: index + 1, playerIds: group }));

    return this.appService.createGames(normalizedAssignments);
  }

  @Patch('games/:id/complete')
  completeGame(
    @Param('id', ParseIntPipe) id: number,
    @Body() score: Partial<GameScore>,
  ) {
    return this.appService.completeGame(id, score);
  }
}
