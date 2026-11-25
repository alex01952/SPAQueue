import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MemberPointsController } from './member-points.controller';
import { MemberPointsService } from './member-points.service';
import { RewardsController } from './rewards.controller';
import { StoreService } from './store.service';
import { OpenPlayController } from './open-play.controller';
import { OpenPlayService } from './open-play.service';
import { GoldMembershipController } from './gold-membership.controller';
import { GoldMembershipService } from './gold-membership.service';

@Module({
  imports: [],
  controllers: [AppController, MemberPointsController, RewardsController, OpenPlayController, GoldMembershipController],
  providers: [AppService, MemberPointsService, StoreService, OpenPlayService, GoldMembershipService],
})
export class AppModule {}
