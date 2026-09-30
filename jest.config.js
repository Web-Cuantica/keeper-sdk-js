/** Configuración de Jest para los tests unitarios del SDK. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      // statements/lines altos; functions más bajos porque startKeeper() (arranque
      // real del NodeSDK + exporters OTLP) no es unit-testeable sin smoke.
      statements: 80,
      branches: 70,
      functions: 50,
      lines: 80,
    },
  },
};
