import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEnv } from '../src/validator.js';

test('validates required and optional variables', () => {
  const report = validateEnv({
    REQUIRED: { type: 'string', required: true },
    OPTIONAL: { type: 'string', required: false }
  }, {});

  assert.equal(report.valid, false);
  assert.deepEqual(report.errors.map((issue) => issue.code), ['missing']);
  assert.equal(report.errors[0].key, 'REQUIRED');
});

test('validates enum, regex, email, and URL values', () => {
  const report = validateEnv({
    MODE: { type: 'enum', enum: ['development', 'production'] },
    SLUG: { pattern: '^[a-z]+-[0-9]+$' },
    EMAIL: { type: 'email' },
    HOMEPAGE: { type: 'url' }
  }, {
    MODE: 'staging',
    SLUG: 'release_one',
    EMAIL: 'not-an-email',
    HOMEPAGE: 'not-a-url'
  });

  assert.deepEqual(report.errors.map((issue) => issue.code).sort(), ['email', 'enum', 'pattern', 'type']);
});

test('validates numeric ranges and booleans', () => {
  const report = validateEnv({
    PORT: { type: 'number', min: 1, max: 65535 },
    DEBUG: { type: 'boolean' }
  }, { PORT: '70000', DEBUG: 'yes' });

  assert.deepEqual(report.errors.map((issue) => issue.code), ['range', 'type']);
});

test('validates JSON and length constraints', () => {
  const report = validateEnv({
    CONFIG: { type: 'json' },
    NAME: { minLength: 3, maxLength: 5 }
  }, { CONFIG: '{broken', NAME: 'toolong' });

  assert.deepEqual(report.errors.map((issue) => issue.code), ['json', 'length']);
});

test('reports weak secrets as warnings by default', () => {
  const report = validateEnv({ API_KEY: { type: 'string', secret: true } }, {
    API_KEY: 'change-me'
  });

  assert.equal(report.valid, true);
  assert.equal(report.warnings.length, 1);
  assert.equal(report.warnings[0].code, 'weak_secret');
});

test('strict warning mode makes weak secrets invalid', () => {
  const report = validateEnv({ API_KEY: { secret: true } }, {
    API_KEY: 'change-me'
  }, { strictWarnings: true });

  assert.equal(report.valid, false);
  assert.equal(report.errors.length, 0);
  assert.equal(report.warnings.length, 1);
});

test('accepts valid values across all constraint types', () => {
  const report = validateEnv({
    MODE: { enum: ['development'] },
    PORT: { type: 'number', min: 1, max: 65535 },
    EMAIL: { type: 'email' },
    CONFIG: { type: 'json' },
    API_KEY: { secret: true, minLength: 12 }
  }, {
    MODE: 'development',
    PORT: '3000',
    EMAIL: 'dev@example.com',
    CONFIG: '{"feature":true}',
    API_KEY: 'a-long-random-secret'
  });

  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});
