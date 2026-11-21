/**
 * Vercel Function handler. scripts/build-serverless.mjs bundles this file and every dependency into
 * one ES module (.serverless/handler.mjs, served by api/index.mjs), so nothing on Vercel relies on require() of an ES module at runtime
 * (@cosmjs 0.39 does that, and Vercel's function loader refuses it). The Nest app is created once per
 * instance and reused across requests (Fluid compute). The environment comes from the Vercel project.
 */
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppModule } from './app.module.js';
import { configureApp } from './app.factory.js';
import { config } from './config.js';

let ready: Promise<(req: IncomingMessage, res: ServerResponse) => void> | undefined;

function init() {
  ready ??= (async () => {
    config(); // fail fast on bad configuration
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'], bodyParser: false });
    configureApp(app);
    await app.init();
    return app.getHttpAdapter().getInstance() as (req: IncomingMessage, res: ServerResponse) => void;
  })();
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const express = await init();
  express(req, res);
}
