import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cliPath = path.resolve('bin/cli.js');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'env-doctor-cli-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });
}

test('CLI emits a JSON report and uses exit code 0 for valid input', () => {
  const directory = temporaryDirectory();
  const schemaPath = write(path.join(directory, '.env.example'), 'PORT=3000 # type: number\n');
  const envPath = write(path.join(directory, '.env'), 'PORT=3000\n');

  const result = runCli(['--json', '--ignore-process-env', schemaPath, envPath], directory);

  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.summary.checked, 1);
});

test('CLI uses exit code 1 for validation errors', () => {
  const directory = temporaryDirectory();
  const schemaPath = write(path.join(directory, '.env.example'), 'PORT=3000 # type: number\n');
  const envPath = write(path.join(directory, '.env'), 'PORT=many\n');

  const result = runCli(['--json', '--ignore-process-env', schemaPath, envPath], directory);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).errors[0].code, 'type');
});

test('CLI uses exit code 2 for warnings', () => {
  const directory = temporaryDirectory();
  const schemaPath = write(path.join(directory, '.env.example'), 'API_KEY= # type: string secret: true\n');
  const envPath = write(path.join(directory, '.env'), 'API_KEY=change-me\n');

  const result = runCli(['--json', '--ignore-process-env', schemaPath, envPath], directory);

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.warnings[0].code, 'weak_secret');
});

test('CLI fixes missing required values before reporting', () => {
  const directory = temporaryDirectory();
  const schemaPath = write(path.join(directory, '.env.example'), 'MISSING=fallback # required: true\n');
  const envPath = write(path.join(directory, '.env'), '');

  const result = runCli(['--json', '--ignore-process-env', '--fix', schemaPath, envPath], directory);

  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).fix.changes[0].key, 'MISSING');
  assert.equal(fs.readFileSync(envPath, 'utf8'), 'MISSING=fallback\n');
});

test('CLI initializes a project', () => {
  const directory = temporaryDirectory();

  const result = runCli(['--init'], directory);

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(directory, '.env.example')), true);
  assert.equal(fs.existsSync(path.join(directory, '.env')), true);
});
