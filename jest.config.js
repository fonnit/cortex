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
  // Exclude orphan executor worktrees (dirty copies of source under .claude/worktrees/).
  // Without this, jest discovers stale duplicates of every test and runs them
  // against pre-h9w source.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/.claude/worktrees/'],
  modulePathIgnorePatterns: ['/.claude/worktrees/'],
  // Resource caps — without these jest defaults to N-1 workers (≈7-11 on this
  // machine), and each worker loads PrismaClient+OpenAI+ws+pg-mem at module
  // init. Combined with the running docker Postgres + Next.js dev server,
  // running the full suite peaks RAM on a 16GB Mac and triggers swap thrash
  // ("computer collapses"). 2 workers + 768MB ceiling keeps the run inside a
  // safe envelope without making test wallclock dramatically worse.
  maxWorkers: 2,
  workerIdleMemoryLimit: '768MB',
  testTimeout: 30_000,
}

module.exports = config
