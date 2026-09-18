import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseEnvContent, parseEnvFileDetailed } from '../src/parser.js';

function temporaryFile(contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'env-doctor-'));
  const filePath = path.join(directory, '.env');
  fs.writeFileSync(filePath, contents);
  return filePath;
}

test('parseEnvContent handles quotes, comments, escapes, and multiline values', () => {
  const parsed = parseEnvContent(`
    PLAIN=value # ordinary comment
    HASH="value-with-#-hash" # type: string
    SINGLE='single # value'
    MULTILINE="first line
    second line"
    EXPORTED=exported
  `);

  assert.equal(parsed.values.PLAIN, 'value');
  assert.equal(parsed.values.HASH, 'value-with-#-hash');
  assert.equal(parsed.values.SINGLE, 'single # value');
  assert.equal(parsed.values.MULTILINE, 'first line\n    second line');
  assert.equal(parsed.values.EXPORTED, 'exported');
  assert.equal(parsed.entries.HASH.type, 'string');
});

test('parseEnvContent reports duplicate keys and keeps the last value', () => {
  const parsed = parseEnvContent('PORT=3000\nPORT=4000 # type: number\n');

  assert.equal(parsed.values.PORT, '4000');
  assert.equal(parsed.entries.PORT.type, 'number');
  assert.deepEqual(parsed.duplicates, [{
    key: 'PORT',
    firstLine: 1,
    line: 2,
    source: '<memory>'
  }]);
});

test('parseDirectives reads schema constraints', () => {
  const parsed = parseEnvContent('MODE=development # type: enum enum: development,production required: true\n');

  assert.deepEqual(parsed.entries.MODE, {
    value: 'development',
    type: 'enum',
    required: true,
    enum: ['development', 'production'],
    source: '<memory>',
    line: 1
  });
});

test('parseEnvFileDetailed returns null for a missing file', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'env-doctor-')), 'missing');
  assert.equal(parseEnvFileDetailed(filePath), null);
});

test('parseEnvFileDetailed preserves source and line metadata', () => {
  const filePath = temporaryFile('EMAIL=test@example.com # type: email\n');
  const parsed = parseEnvFileDetailed(filePath);

  assert.equal(parsed.path, filePath);
  assert.equal(parsed.entries.EMAIL.line, 1);
  assert.equal(parsed.entries.EMAIL.type, 'email');
});
