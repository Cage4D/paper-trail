import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { config } from '../config.js';

/** Prisma 7 with the pg driver adapter (works on Vercel Functions and locally). */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: config().DATABASE_URL }) });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
