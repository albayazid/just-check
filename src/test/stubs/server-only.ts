// Empty stub for the `server-only` package.
//
// The real `server-only` throws when imported outside a Next.js server
// context. Vitest runs under jsdom which trips the "client" branch, so every
// `*.server.ts` test would crash at import. Aliased to this empty module in
// vitest.config.ts → server-only imports become no-ops under test.
export {};
