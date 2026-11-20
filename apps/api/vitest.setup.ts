import { config } from 'dotenv';
// the single repo-root .env (local Postgres, contract address, secrets); never printed
config({ path: new URL('../../.env', import.meta.url).pathname, quiet: true });
