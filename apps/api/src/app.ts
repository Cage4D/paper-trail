/**
 * Vercel entry (zero-config NestJS: Vercel detects src/app.ts and runs it on Vercel Functions with
 * Fluid compute). The environment comes from the Vercel project; nothing is read from disk.
 * Local development uses src/main.ts, which also loads the repo-root .env.
 */
import { createApp } from './app.factory.js';

const app = await createApp();
await app.listen(process.env.PORT ?? 3000);
