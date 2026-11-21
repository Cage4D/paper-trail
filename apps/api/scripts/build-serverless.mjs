// Bundle src/serverless.ts and its dependencies into .serverless/handler.mjs (one ES module) for Vercel;
// api/index.mjs (committed) re-exports it as the Vercel Function.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/serverless.ts'],
  outfile: '.serverless/handler.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  // CJS dependencies call require(); give the ESM bundle one
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // Nest's optional integrations we do not use (loaded lazily only if present)
  external: [
    '@nestjs/microservices', '@nestjs/microservices/*', '@nestjs/websockets', '@nestjs/websockets/*',
    'class-transformer', 'class-transformer/*', 'class-validator', '@fastify/static', '@nestjs/platform-fastify',
    'pg-native',
  ],
  logLevel: 'warning',
  legalComments: 'none',
});
console.log('built .serverless/handler.mjs');
