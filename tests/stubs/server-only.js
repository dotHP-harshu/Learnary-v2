// Test stub for the `server-only` package.
//
// `server-only` ships a module that throws unless the bundler resolves the
// `react-server` condition. Vitest runs plain Node, so both `server-only` and
// every module that imports it (config.js, practiceSchema.js, …) would fail to
// load. This empty module is aliased in vitest.config.mjs.
export {};
