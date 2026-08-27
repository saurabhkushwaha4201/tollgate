/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',          // server entrypoint — tested via integration, not unit
    '!src/config/**/*.ts',    // infrastructure wiring (db, redis, logger)
    '!src/types/**/*.ts',     // type definitions only
  ],
  coverageReporters: ['text', 'lcov', 'json-summary'],
};
