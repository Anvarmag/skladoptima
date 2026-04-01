import { Module } from '@nestjs/common';
import { MaxNotifierService } from './max-notifier.service';
import { MaxNotifierController } from './max-notifier.controller';

@Module({
  providers: [MaxNotifierService],
  controllers: [MaxNotifierController],
  exports: [MaxNotifierService],
})
export class MaxNotifierModule {}
