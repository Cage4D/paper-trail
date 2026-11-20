import { config as loadEnv } from 'dotenv';
// local development: the single repo-root .env (on Vercel the env comes from the project)
loadEnv({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true });
const { createApp } = await import('./app.factory.js');
const app = await createApp();
await app.listen(process.env.PORT ?? 3000);
