/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts', '**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  transformIgnorePatterns: ['/node_modules/'],
  // Several suites boot the full Express app (ts-jest compile + RS256/JWKS
  // init) and do real bcrypt hashing. Under parallel execution that can
  // exceed jest's 5s default for whichever boot-heavy suite loses the CPU
  // race (they all pass in isolation). CI runs `jest --detectOpenHandles`
  // which implies --runInBand, so CI never hits this — but a bare
  // `npx jest` (parallel) would flake. 30s removes the contention flake
  // without masking real hangs.
  testTimeout: 30000,
};
