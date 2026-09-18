import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { diagnose, fixEnv, initProject } from '../src/index.js';

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'env-doctor-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

test('diagnose merges multiple env files and expands values without mutating process.env', () => {
  const directory = temporaryDirectory();
  const schemaPath = write(path.join(directory, '.env.example'), [
    'BASE=from-file',
    'DERIVED=${BASE}/child # type: string',
    'PORT=3000 # type: number',
    ''
  ].join('\n'));
  const firstPath = write(path.join(directory, '.env.base'), 'BASE=from-file\nDERIVED=${BASE}/child\n');
  const secondPath = write(path.join(directory, '.env.local'), 'PORT=4000\n');
  const processEnv = { BASE: 'from-process' };

  const report = diagnose(schemaPath, [firstPath, secondPath], {
    processEnv,
    includeValues: true
  });

  assert.equal(report.valid, true);
  assert.equal(report.values.DERIVED, 'from-file/child');
  assert.equal(report.values.PORT, '4000');
  assert.equal(processEnv.BASE, 'from-process');
});

test('diagnose supports a custom JSON schema', () => {
  const directory = temporaryDirectory();
  const schemaPath = write(path.join(directory, 'schema.json'), JSON.stringify({
    variables: {
      MODE: { type: 'enum', enum: ['dev', 'prod'], required: true },
      COUNT: { type: 'number', min: 1, max: 3, required: true }
    }
  }));
  const envPath = write(path.join(directory, '.env'), 'MODE=dev\nCOUNT=2\n');

  const report = diagnose(schemaPath, envPath, { processEnv: {} });

  assert.equal(report.valid, true);
  assert.equal(report.schema.path, schemaPath);
});

test('diagnose reports duplicates as warnings', () => {
  const directory = temporaryDirectory();
  const schemaPath = write(path.join(directory, '.env.example'), 'PORT=3000 # type: number\n');
  const envPath = write(path.join(directory, '.env'), 'PORT=3000\nPORT=4000\n');

  const report = diagnose(schemaPath, envPath, { processEnv: {} });

  assert.equal(report.valid, true);
  assert.equal(report.warnings[0].code, 'duplicate');
  assert.equal(report.warnings[0].key, 'PORT');
});

test('fixEnv adds missing required values from schema defaults', () => {
  const directory = temporaryDirectory();
  const schemaPath = write(path.join(directory, '.env.example'), `
EXISTING=value
MISSING=fallback # required: true
EMPTY=fallback # required: true
OPTIONAL=fallback # required: false
`);
  const envPath = write(path.join(directory, '.env'), 'EXISTING=value\nEMPTY=\n');

  const result = fixEnv(schemaPath, envPath);

  assert.equal(result.changed, true);
  assert.deepEqual(result.changes, [
    { key: 'MISSING', action: 'added' },
    { key: 'EMPTY', action: 'updated' }
  ]);
  assert.match(fs.readFileSync(envPath, 'utf8'), /MISSING=fallback/);
  assert.match(fs.readFileSync(envPath, 'utf8'), /EMPTY=fallback/);
});

test('initProject creates schema and env files without overwriting them', () => {
  const directory = temporaryDirectory();
  const schemaPath = path.join(directory, '.env.example');
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(schemaPath, 'existing\n');
  fs.writeFileSync(envPath, 'keep\n');

  const first = initProject(directory);
  const second = initProject(directory);

  assert.equal(first.created.length, 0);
  assert.equal(second.created.length, 0);
  assert.equal(fs.readFileSync(schemaPath, 'utf8'), 'existing\n');
  assert.equal(fs.readFileSync(envPath, 'utf8'), 'keep\n');
});

test('initProject creates a JSON schema when requested', () => {
  const directory = temporaryDirectory();
  const schemaPath = path.join(directory, 'schema.json');

  initProject(directory, { schemaPath: 'schema.json' });

  assert.equal(JSON.parse(fs.readFileSync(schemaPath, 'utf8')).variables.PORT.type, 'number');
});
