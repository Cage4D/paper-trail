import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { ErrorFilter } from './common/error.filter.js';
import { config } from './config.js';

/** Shared by main.ts (local), the tests, and the Vercel entry (Phase 7). */
export async function createApp(): Promise<NestExpressApplication> {
  config(); // fail fast on bad configuration
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'], bodyParser: false });
  app.useBodyParser('json', { limit: '6mb' });
  app.use(cookieParser());
  app.enableCors({ origin: config().CORS_ORIGIN.split(','), credentials: true });
  app.useGlobalFilters(new ErrorFilter());
  // BigInt-safe JSON
  app.getHttpAdapter().getInstance().set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  return app;
}
