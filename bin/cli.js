#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose, fixEnv, initProject } from '../src/index.js';

const DEFAULT_SCHEMA = '.env.example';
const DEFAULT_ENV = '.env';
const EXIT_VALID = 0;
const EXIT_ERRORS = 1;
const EXIT_WARNINGS = 2;
const EXIT_USAGE = 3;
const EXIT_RUNTIME = 4;

function parseArgs(argv) {
  const options = {
    schemaPath: DEFAULT_SCHEMA,
    envPaths: [],
    json: false,
    fix: false,
    init: false,
    initDirectory: '.',
    watch: false,
    strictWarnings: false,
    expand: true,
    ignoreProcessEnv: false,
    help: false,
    version: false
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }

    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--fix') {
      options.fix = true;
    } else if (argument === '--watch') {
      options.watch = true;
    } else if (argument === '--strict-warnings' || argument === '--strict') {
      options.strictWarnings = true;
    } else if (argument === '--no-expand') {
      options.expand = false;
    } else if (argument === '--ignore-process-env' || argument === '--no-process-env') {
      options.ignoreProcessEnv = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--version' || argument === '-V') {
      options.version = true;
    } else if (argument === '--schema') {
      options.schemaPath = requireValue(argv, ++index, argument);
    } else if (argument === '--env') {
      options.envPaths.push(...splitPaths(requireValue(argv, ++index, argument)));
    } else if (argument === '--init') {
      options.init = true;
      if (argv[index + 1] && !argv[index + 1].startsWith('-')) {
        options.initDirectory = argv[++index];
      }
    } else if (argument.startsWith('--schema=')) {
      options.schemaPath = argument.slice('--schema='.length);
    } else if (argument.startsWith('--env=')) {
      options.envPaths.push(...splitPaths(argument.slice('--env='.length)));
    } else if (argument.startsWith('-')) {
      throw new Error(`Unbekannte Option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  if (positional.length > 0) {
    options.schemaPath = positional.shift();
  }
  options.envPaths.push(...positional.flatMap(splitPaths));
  if (options.envPaths.length === 0) {
    options.envPaths.push(DEFAULT_ENV);
  }

  if (options.init && (options.fix || options.watch)) {
    throw new Error('--init kann nicht mit --fix oder --watch kombiniert werden.');
  }
  if (options.fix && options.watch) {
    throw new Error('--fix kann nicht mit --watch kombiniert werden.');
  }

  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('-')) {
    throw new Error(`Für ${option} wird ein Wert benötigt.`);
  }
  return value;
}

function splitPaths(value) {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function readVersion() {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
}

function helpText() {
  return `env-doctor <schema> <env...>

Umgebungsvariablen gegen eine Schema-Vorlage prüfen.

Optionen:
  --schema <path>       JSON-Schema oder .env-Vorlage (Standard: .env.example)
  --env <path>          Env-Datei; mehrfache Angabe oder Komma möglich
  --json                Report als JSON ausgeben
  --fix                 Fehlende Pflichtwerte aus der Vorlage ergänzen
  --init [directory]    .env.example und .env anlegen
  --watch               Dateien beobachten und bei Änderungen neu prüfen
  --strict-warnings     Warnungen als Fehler behandeln
  --no-expand           dotenv-expand nicht ausführen
  --ignore-process-env  Prozess-Umgebung nicht als Fallback verwenden
  -h, --help            Hilfe anzeigen
  -V, --version         Version anzeigen

Exit-Codes:
  0 gültig, 1 Validierungsfehler, 2 Warnungen, 3 Bedienfehler, 4 Laufzeitfehler`;
}

function printHuman(report, fixReport) {
  const { summary } = report;
  console.log(`env-doctor: ${summary.checked} Variablen geprüft`);

  if (fixReport?.changed) {
    console.log(`Repariert: ${fixReport.changes.map((change) => change.key).join(', ')}`);
  }

  if (report.errors.length > 0) {
    console.error('\nFehler:');
    report.errors.forEach((issue) => {
      console.error(`  ${issue.key}: ${issue.message}`);
    });
  }

  if (report.warnings.length > 0) {
    console.error('\nWarnungen:');
    report.warnings.forEach((issue) => {
      console.error(`  ${issue.key}: ${issue.message}`);
    });
  }

  if (report.valid) {
    console.log(report.warnings.length > 0 ? '\nUmgebungsvariablen sind gültig, aber es gibt Warnungen.' : '\nUmgebungsvariablen sind gültig.');
  } else {
    console.error('\nUmgebungsvariablen sind ungültig.');
  }
}

function jsonReport(report, fixReport) {
  return {
    ...report,
    fix: fixReport || null,
    exitCode: report.errors.length > 0 ? EXIT_ERRORS : report.warnings.length > 0 ? EXIT_WARNINGS : EXIT_VALID
  };
}

function runDiagnosis(options) {
  const fixReport = options.fix ? fixEnv(options.schemaPath, options.envPaths) : null;
  const report = diagnose(options.schemaPath, options.envPaths, {
    strictWarnings: options.strictWarnings,
    expand: options.expand,
    ignoreProcessEnv: options.ignoreProcessEnv
  });
  const exitCode = report.errors.length > 0 ? EXIT_ERRORS : report.warnings.length > 0 ? EXIT_WARNINGS : EXIT_VALID;

  if (options.json) {
    console.log(JSON.stringify(jsonReport(report, fixReport), null, 2));
  } else {
    printHuman(report, fixReport);
  }

  return exitCode;
}

function runInit(options) {
  const result = initProject(options.initDirectory, {
    schemaPath: options.schemaPath === DEFAULT_SCHEMA ? '.env.example' : options.schemaPath,
    envPath: options.envPaths[0] === DEFAULT_ENV ? '.env' : options.envPaths[0]
  });

  if (options.json) {
    console.log(JSON.stringify({ init: result, exitCode: EXIT_VALID }, null, 2));
  } else {
    console.log(result.created.length > 0 ? `Angelegt: ${result.created.join(', ')}` : 'Dateien sind bereits vorhanden.');
  }

  return EXIT_VALID;
}

function existingAncestor(filePath) {
  let current = path.dirname(path.resolve(filePath));
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Kein übergeordnetes Verzeichnis für "${filePath}" gefunden.`);
    }
    current = parent;
  }
  return current;
}

function watchPaths(options, callback) {
  const absolutePaths = [options.schemaPath, ...options.envPaths].map((watchPath) => path.resolve(watchPath));
  const targets = [...new Set(absolutePaths.map(existingAncestor))];
  const watchers = [];

  targets.forEach((target) => {
    const watcher = fs.watch(target, (eventType, changedFilename) => {
      if (!changedFilename) {
        callback();
        return;
      }
      const changedPath = path.resolve(target, changedFilename.toString());
      if (absolutePaths.includes(changedPath)) {
        callback();
      }
    });
    watchers.push(watcher);
  });

  return () => watchers.forEach((watcher) => watcher.close());
}

function runWatch(options) {
  let timer;
  let running = false;
  const execute = (initial = false) => {
    if (running) {
      return;
    }
    running = true;
    try {
      runDiagnosis(options);
    } catch (error) {
      if (initial) {
        throw error;
      }
      if (options.json) {
        console.log(JSON.stringify({ valid: false, error: error.message, exitCode: EXIT_RUNTIME }, null, 2));
      } else {
        console.error(`Laufzeitfehler: ${error.message}`);
      }
    } finally {
      running = false;
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => execute(), 100);
  };

  execute(true);
  const stop = watchPaths(options, schedule);
  process.once('SIGINT', () => {
    stop();
    clearTimeout(timer);
    process.exit(EXIT_VALID);
  });
  process.once('SIGTERM', () => {
    stop();
    clearTimeout(timer);
    process.exit(EXIT_VALID);
  });
}

let options;
try {
  options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(helpText());
    process.exit(EXIT_VALID);
  }

  if (options.version) {
    console.log(readVersion());
    process.exit(EXIT_VALID);
  }

  if (options.init) {
    process.exit(runInit(options));
  }

  if (options.watch) {
    runWatch(options);
  } else {
    process.exit(runDiagnosis(options));
  }
} catch (error) {
  console.error(`env-doctor: ${error.message}`);
  process.exit(options && (options.init || options.watch) ? EXIT_RUNTIME : EXIT_USAGE);
}
