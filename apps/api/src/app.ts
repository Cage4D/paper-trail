/**
 * Vercel entry (zero-config NestJS: Vercel looks for src/app.ts importing @nestjs/core and runs it
 * on Vercel Functions with Fluid compute). The environment comes from the Vercel project; nothing
 * is read from disk. Local development uses src/main.ts, which also loads the repo-root .env.
 */
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.factory.js';
import { config } from './config.js';

config(); // fail fast on bad configuration
const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'], bodyParser: false });
configureApp(app);
await app.listen(process.env.PORT ?? 3000);
