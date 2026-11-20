import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { ErrorFilter } from './common/error.filter.js';
import { config } from './config.js';

/** Middleware, CORS, error shape. Shared by createApp and the tests. */
export function configureApp(app: INestApplication): void {
  const x = app as NestExpressApplication;
  x.useBodyParser('json', { limit: '6mb' });
  x.use(cookieParser());
  x.enableCors({ origin: config().CORS_ORIGIN.split(','), credentials: true });
  x.useGlobalFilters(new ErrorFilter());
  // BigInt-safe JSON
  x.getHttpAdapter().getInstance().set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Used by main.ts (local) and the Vercel entry (Phase 7). */
export async function createApp(): Promise<NestExpressApplication> {
  config(); // fail fast on bad configuration
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'], bodyParser: false });
  configureApp(app);
  return app;
}
