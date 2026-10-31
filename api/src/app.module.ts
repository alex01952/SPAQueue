import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MemberPointsController } from './member-points.controller';
import { MemberPointsService } from './member-points.service';

@Module({
  imports: [],
  controllers: [AppController, MemberPointsController],
  providers: [AppService, MemberPointsService],
})
export class AppModule {}
