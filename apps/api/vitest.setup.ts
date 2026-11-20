import { config } from 'dotenv';
// the single repo-root .env (contract address, secrets); never printed
config({ path: new URL('../../.env', import.meta.url).pathname, quiet: true });
// Tests wipe and fill tables, so they ALWAYS run against a separate database
// (<db>_test on the same server), never the development database.
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  if (!u.pathname.endsWith('_test')) u.pathname = `${u.pathname}_test`;
  process.env.DATABASE_URL = u.toString();
}
