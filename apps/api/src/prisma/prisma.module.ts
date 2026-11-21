import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { LockService } from '../common/lock.service.js';
import { RateLimitService } from '../common/rate-limit.service.js';

@Global()
@Module({ providers: [PrismaService, LockService, RateLimitService], exports: [PrismaService, LockService, RateLimitService] })
export class PrismaModule {}
