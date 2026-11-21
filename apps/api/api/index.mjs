// Vercel Function: every request is rewritten here (vercel.json). The handler is the Nest app
// bundled by scripts/build-serverless.mjs during the Vercel build.
export { default } from '../.serverless/handler.mjs';
