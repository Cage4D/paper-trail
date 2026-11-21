/**
 * Validated configuration (spec §9). Secrets are read here and never logged.
 * Locally the repo-root .env is loaded by main.ts; on Vercel the env comes from the project.
 */
import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  /** Direct (non-pooled) connection, e.g. Neon's DATABASE_URL_UNPOOLED: needed for session advisory locks. */
  DATABASE_URL_UNPOOLED: z.string().optional(),
  /** Bearer secret for the scheduled /internal/index calls (Vercel Cron, GitHub Actions). */
  CRON_SECRET: z.string().min(16).optional(),
  QORE_REST: z.string().url().default('https://api-testnet.qore.host'),
  QORE_RPC: z.string().optional(),
  EVM_RPC: z.string().url().default('https://evm-testnet.qore.host'),
  CHAIN_ID: z.coerce.number().int().default(9800),
  PAPERTRAIL_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  PAPERTRAIL_DEPLOY_BLOCK: z.coerce.bigint().default(0n),
  RELAYER_MNEMONIC: z.string().min(1),
  /** Judge mode (§8): JSON role → BIP-39 mnemonic. DEMO, testnet only; never real users' keys. */
  DEMO_MNEMONICS: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  ADMIN_TOKEN: z.string().min(16),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** SIWQ domain/URI the sign-in messages are issued for. */
  APP_DOMAIN: z.string().default('localhost:3000'),
  APP_URI: z.string().default('http://localhost:3000'),
  NODE_ENV: z.string().default('development'),
});
export type AppConfig = z.infer<typeof Env>;

let cached: AppConfig | undefined;
export function config(): AppConfig {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    // names only, never values
    throw new Error(`invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  if (parsed.data.CHAIN_ID !== 9800) throw new Error('testnet only: CHAIN_ID must be 9800 (qorechain-diana)');
  cached = parsed.data;
  return cached;
}
/** Test hook. */
export function setConfigForTests(c: Partial<AppConfig>): void {
  cached = { ...(cached ?? ({} as AppConfig)), ...c } as AppConfig;
}
