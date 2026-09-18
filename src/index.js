import fs from 'node:fs';
import path from 'node:path';
import { expand } from 'dotenv-expand';
import { parseEnvFileDetailed } from './parser.js';
import { normalizeSchema, validateEnv } from './validator.js';

const DEFAULT_SCHEMA_PATH = '.env.example';
const DEFAULT_ENV_PATH = '.env';

function asArray(value, fallback = []) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return Array.isArray(value) ? value : [value];
}

function readJsonSchema(schemaPath) {
  const content = fs.readFileSync(schemaPath, 'utf8');
  const parsed = JSON.parse(content);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Schema "${schemaPath}" muss ein JSON-Objekt sein.`);
  }

  if (parsed.variables && typeof parsed.variables === 'object' && !Array.isArray(parsed.variables)) {
    return parsed.variables;
  }

  if (parsed.schema && typeof parsed.schema === 'object' && !Array.isArray(parsed.schema)) {
    return parsed.schema;
  }

  if (parsed.properties && typeof parsed.properties === 'object' && !Array.isArray(parsed.properties)) {
    const required = new Set(Array.isArray(parsed.required) ? parsed.required : []);
    return Object.fromEntries(
      Object.entries(parsed.properties).map(([key, meta]) => [
        key,
        {
          ...(meta && typeof meta === 'object' ? meta : {}),
          required: meta && typeof meta === 'object' && meta.required !== undefined
            ? meta.required
            : required.has(key)
        }
      ])
    );
  }

  return parsed;
}

function loadSchema(schemaPath, customSchema) {
  if (customSchema && typeof customSchema === 'object') {
    return customSchema;
  }

  if (typeof customSchema === 'string') {
    return readJsonSchema(customSchema);
  }

  const parsed = parseEnvFileDetailed(schemaPath);
  if (!parsed) {
    throw new Error(`Vorlage "${schemaPath}" wurde nicht gefunden.`);
  }

  return parsed.entries;
}

function parseEnvFiles(envPaths) {
  return asArray(envPaths, [DEFAULT_ENV_PATH]).map((envPath) => ({
    path: envPath,
    parsed: parseEnvFileDetailed(envPath)
  }));
}

function mergeEnvFiles(files) {
  const values = {};
  const entries = {};
  const duplicates = [];

  files.forEach(({ path, parsed }, fileIndex) => {
    if (!parsed) {
      return;
    }

    parsed.duplicates.forEach((duplicate) => {
      duplicates.push({
        ...duplicate,
        source: path,
        fileIndex
      });
    });

    Object.entries(parsed.entries).forEach(([key, entry]) => {
      const previous = entries[key];
      if (previous) {
        duplicates.push({
          key,
          firstSource: previous.source,
          firstLine: previous.line,
          source: path,
          line: entry.line,
          fileIndex
        });
      }

      values[key] = entry.value;
      entries[key] = {
        ...entry,
        source: path,
        fileIndex
      };
    });
  });

  return { values, entries, duplicates };
}

function expandValues(values, processEnv, enabled = true) {
  if (!enabled) {
    return { ...values };
  }

  const expansionEnv = { ...processEnv };
  Object.keys(values).forEach((key) => {
    delete expansionEnv[key];
  });

  const result = expand({
    parsed: { ...values },
    processEnv: expansionEnv
  });

  return result.parsed || { ...values };
}

function normalizeOptions(options = {}) {
  return {
    ...options,
    processEnv: options.processEnv !== undefined ? options.processEnv : process.env,
    expand: options.expand !== false,
    strictWarnings: Boolean(options.strictWarnings)
  };
}

function fileReport(file) {
  return {
    path: file.path,
    exists: Boolean(file.parsed),
    variables: file.parsed ? Object.keys(file.parsed.entries) : [],
    duplicates: file.parsed ? file.parsed.duplicates : []
  };
}

export function diagnose(examplePath = DEFAULT_SCHEMA_PATH, envPaths = DEFAULT_ENV_PATH, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const schemaPath = options.schemaPath || examplePath;
  const schemaSource = loadSchema(schemaPath, options.schema);
  const schema = normalizeSchema(schemaSource);
  const resolvedEnvPaths = options.envPaths || options.envPath || envPaths;
  const files = parseEnvFiles(resolvedEnvPaths);
  const merged = mergeEnvFiles(files);
  const expandedValues = expandValues(
    merged.values,
    normalizedOptions.ignoreProcessEnv ? {} : normalizedOptions.processEnv,
    normalizedOptions.expand
  );
  const actualValues = {};

  Object.keys(schema).forEach((key) => {
    if (Object.hasOwn(expandedValues, key)) {
      actualValues[key] = expandedValues[key];
    } else if (!normalizedOptions.ignoreProcessEnv && Object.hasOwn(normalizedOptions.processEnv, key)) {
      actualValues[key] = normalizedOptions.processEnv[key];
    }
  });

  const validation = validateEnv(schema, actualValues, {
    normalized: true,
    strictWarnings: normalizedOptions.strictWarnings
  });
  const duplicateWarnings = merged.duplicates.map((duplicate) => ({
    key: duplicate.key,
    code: 'duplicate',
    message: duplicate.firstSource && duplicate.firstSource !== duplicate.source
      ? `Duplikat: zuerst in "${duplicate.firstSource}:${duplicate.firstLine}", zuletzt in "${duplicate.source}:${duplicate.line}".`
      : `Duplikat: zuerst in Zeile ${duplicate.firstLine}, zuletzt in Zeile ${duplicate.line}.`
  }));
  validation.warnings.push(...duplicateWarnings);
  validation.summary.warnings = validation.warnings.length;
  validation.valid = validation.errors.length === 0 && (!normalizedOptions.strictWarnings || validation.warnings.length === 0);
  const envFiles = files.map(fileReport);

  return {
    ...validation,
    schema: {
      path: typeof options.schema === 'string' ? options.schema : schemaPath,
      variables: Object.keys(schema)
    },
    envFiles,
    duplicates: merged.duplicates,
    values: normalizedOptions.includeValues ? expandedValues : undefined
  };
}

function serializeValue(value) {
  const stringValue = String(value ?? '');
  if (stringValue.includes('\n') || stringValue.includes('\r') || stringValue.includes('#')) {
    return JSON.stringify(stringValue);
  }
  return stringValue;
}

function loadSchemaForFix(schemaSource) {
  if (schemaSource && typeof schemaSource === 'object') {
    return schemaSource;
  }
  if (typeof schemaSource === 'string') {
    if (schemaSource.endsWith('.json')) {
      return readJsonSchema(schemaSource);
    }
    const parsed = parseEnvFileDetailed(schemaSource);
    return parsed ? parsed.entries : {};
  }
  return {};
}

export function fixEnv(schemaSource = DEFAULT_SCHEMA_PATH, envPath = DEFAULT_ENV_PATH, options = {}) {
  const schema = normalizeSchema(loadSchemaForFix(schemaSource));
  const resolvedEnvPaths = asArray(envPath, [DEFAULT_ENV_PATH]);
  const targetPath = resolvedEnvPaths[resolvedEnvPaths.length - 1] || DEFAULT_ENV_PATH;
  const existing = parseEnvFileDetailed(targetPath);
  const content = existing ? fs.readFileSync(targetPath, 'utf8') : '';
  const lines = content.split(/\r?\n/);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const changes = [];

  Object.values(schema).forEach((rule) => {
    if (!rule.required) {
      return;
    }

    const currentValue = existing?.values[rule.key];
    if (currentValue !== undefined && currentValue !== '') {
      return;
    }

    const replacement = `${rule.key}=${serializeValue(rule.default)}`;
    if (currentValue === undefined) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      lines.push(replacement);
      changes.push({ key: rule.key, action: 'added' });
      return;
    }

    const entry = existing.entries[rule.key];
    if (entry && entry.line >= 1 && entry.line <= lines.length) {
      lines[entry.line - 1] = replacement;
      changes.push({ key: rule.key, action: 'updated' });
    }
  });

  if (changes.length === 0) {
    return { changed: false, changes, path: targetPath };
  }

  fs.writeFileSync(targetPath, `${lines.join(eol)}${eol}`);
  return { changed: true, changes, path: targetPath };
}

const DEFAULT_TEMPLATE = `APP_ENV=development # type: enum enum: development,production
PORT=3000 # type: number min: 1 max: 65535
ADMIN_EMAIL= # type: email
APP_CONFIG={} # type: json
API_KEY= # type: string secret: true minLength: 16
`;

const DEFAULT_JSON_TEMPLATE = {
  variables: {
    APP_ENV: { type: 'enum', enum: ['development', 'production'], required: true },
    PORT: { type: 'number', min: 1, max: 65535, required: true },
    ADMIN_EMAIL: { type: 'email', required: true },
    APP_CONFIG: { type: 'json', required: true },
    API_KEY: { type: 'string', secret: true, minLength: 16, required: true }
  }
};

export function initProject(directory = '.', options = {}) {
  const root = path.resolve(directory);
  const schemaPath = options.schemaPath || '.env.example';
  const envPath = options.envPath || '.env';
  const fullSchemaPath = path.isAbsolute(schemaPath) ? schemaPath : path.join(root, schemaPath);
  const fullEnvPath = path.isAbsolute(envPath) ? envPath : path.join(root, envPath);
  const created = [];

  fs.mkdirSync(path.dirname(fullSchemaPath), { recursive: true });
  fs.mkdirSync(path.dirname(fullEnvPath), { recursive: true });

  if (!fs.existsSync(fullSchemaPath) || options.force) {
    const schemaContent = fullSchemaPath.endsWith('.json')
      ? `${JSON.stringify(DEFAULT_JSON_TEMPLATE, null, 2)}\n`
      : DEFAULT_TEMPLATE;
    fs.writeFileSync(fullSchemaPath, schemaContent);
    created.push(fullSchemaPath);
  }

  if (!fs.existsSync(fullEnvPath) || options.force) {
    fs.writeFileSync(fullEnvPath, '');
    created.push(fullEnvPath);
  }

  return { created };
}

export { DEFAULT_SCHEMA_PATH, DEFAULT_ENV_PATH };
