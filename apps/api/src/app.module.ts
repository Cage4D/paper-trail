import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { ChainModule } from './chain/chain.module.js';
import { RelayerModule } from './relayer/relayer.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ExamsModule } from './exams/exams.module.js';
import { HealthController } from './health/health.controller.js';
import { InternalController } from './internal/internal.controller.js';

@Module({
  imports: [PrismaModule, ChainModule, RelayerModule, AuthModule, ExamsModule],
  controllers: [HealthController, InternalController],
})
export class AppModule {}
