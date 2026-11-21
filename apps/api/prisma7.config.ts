// Prisma 7 config. Locally DATABASE_URL comes from the repo-root .env (a throwaway Postgres); on
// Vercel the env comes from the project (Neon). Migrations use the DIRECT connection when one is
// set (Neon's DATABASE_URL_UNPOOLED): prisma migrate takes an advisory lock, which a
// transaction-mode pooler cannot hold.
import { existsSync } from "node:fs";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

const rootEnv = new URL("../../.env", import.meta.url).pathname;
if (existsSync(rootEnv)) config({ path: rootEnv, quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL_UNPOOLED"] || process.env["DATABASE_URL"],
  },
});
