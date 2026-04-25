/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // Strip `.js` suffix on relative imports inside agent/ so ESM-style
    // import paths (e.g. `'../scan.js'`) resolve to their TS source under
    // ts-jest's CommonJS+node moduleResolution. Daemon production code uses
    // `--import=tsx` which strips the suffix natively.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: './tsconfig.test.json',
    }],
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
}

module.exports = config
