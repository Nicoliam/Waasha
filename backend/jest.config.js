/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  // Slice 5: execute real Angular provider-booking service logic in Node by
  // stubbing only the Angular DI/http shells — service bodies run unmodified.
  moduleNameMapper: {
    '^@angular/core$': '<rootDir>/tests/stubs/angular-core.stub.ts',
    '^@angular/common/http$': '<rootDir>/tests/stubs/angular-http.stub.ts',
  },
  watchman: false,
};
