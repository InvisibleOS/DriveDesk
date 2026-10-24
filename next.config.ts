import fs from 'node:fs';
import type { NextConfig } from 'next';

// NEXT_DIST lets a preview build sit next to the live one without touching it.
// standalone = a self-contained server (.next*/standalone/server.js) that the desktop app carries inside it;
// never let it pick up saved drives (student data) or the unused image optimiser
const config: NextConfig = {
  distDir: process.env.NEXT_DIST || '.next',
  output: 'standalone',
  // pages are cached in memory only: the desktop app's server must never write inside the app (it would break its signature)
  experimental: { isrFlushToDisk: false },
  env: { DESK_VERSION: JSON.parse(fs.readFileSync('package.json', 'utf8')).version }, // shown under ⋯ › About & updates
  // the data routes load this at runtime and the tracer misses it ("Failed to load external module" in the packaged app)
  outputFileTracingIncludes: { '*': ['node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.prod.js'] },
  outputFileTracingExcludes: { '*': ['data/**', '.next/**', '.next-preview/**', 'node_modules/sharp/**', 'node_modules/@img/**', 'dist/**'] },
};
export default config;
