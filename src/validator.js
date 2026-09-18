const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sensitiveKeyPattern = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|KEY|CREDENTIAL|AUTH)(?:_|$)/i;
const commonWeakValues = new Set([
  'password',
  'passwort',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'admin',
  'root',
  'test',
  'testing',
  'example',
  'sample',
  'changeme',
  'change-me',
  'default',
  'secret',
  'apikey',
  'api-key'
]);

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function parseJson(value) {
  if (typeof value !== 'string') {
    return { valid: false };
  }

  try {
    JSON.parse(value);
    return { valid: true };
  } catch {
    return { valid: false };
  }
}

function entropy(value) {
  const frequencies = {};
  for (const character of value) {
    frequencies[character] = (frequencies[character] || 0) + 1;
  }

  return Object.values(frequencies).reduce((sum, count) => {
    const probability = count / value.length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function isWeakSecret(value, minLength) {
  const normalized = String(value).trim().toLowerCase();
  const reasons = [];

  if (normalized.length < (minLength ?? 12)) {
    reasons.push('zu kurz');
  }
  if (commonWeakValues.has(normalized)) {
    reasons.push('bekannter Standardwert');
  }
  if (/^(.)\1+$/.test(normalized) || /(0123|1234|2345|3456|4567|5678|6789|abcdef)/i.test(normalized)) {
    reasons.push('leicht erratbar');
  }
  if (normalized.length >= 8 && entropy(normalized) < 2.4) {
    reasons.push('zu wenig Entropie');
  }

  return reasons;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  return ['true', 'yes', '1', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeEnum(value) {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeRule(key, meta = {}) {
  const type = String(meta.type || meta.format || 'string').toLowerCase();
  const required = meta.required === undefined ? true : parseBoolean(meta.required);
  const rule = {
    key,
    type,
    required,
    default: meta.default ?? meta.value ?? '',
    enum: normalizeEnum(meta.enum),
    pattern: meta.pattern || meta.regex || null,
    min: meta.min === undefined ? null : Number(meta.min),
    max: meta.max === undefined ? null : Number(meta.max),
    minLength: meta.minLength === undefined ? null : Number(meta.minLength),
    maxLength: meta.maxLength === undefined ? null : Number(meta.maxLength),
    secret: meta.secret === undefined ? sensitiveKeyPattern.test(key) : parseBoolean(meta.secret),
    message: meta.message || null
  };

  if (type === 'email') {
    rule.type = 'email';
  } else if (type === 'json') {
    rule.type = 'json';
  }

  return rule;
}

function compilePattern(rule) {
  if (!rule.pattern) {
    return null;
  }

  try {
    return new RegExp(rule.pattern);
  } catch (error) {
    return error;
  }
}

function makeIssue(rule, code, message) {
  return {
    key: rule.key,
    code,
    message: rule.message || message
  };
}

function validateValue(rule, value) {
  const issues = [];
  const warnings = [];

  if (!isPresent(value)) {
    if (rule.required) {
      issues.push(makeIssue(rule, 'missing', 'Fehlt vollständig in der Umgebung.'));
    }
    return { issues, warnings };
  }

  const stringValue = String(value);

  if (rule.enum.length > 0 && !rule.enum.includes(stringValue)) {
    issues.push(makeIssue(rule, 'enum', `Muss einer der Werte ${rule.enum.map((item) => `"${item}"`).join(', ')} sein.`));
  }

  if (rule.pattern) {
    const pattern = compilePattern(rule);
    if (pattern instanceof RegExp) {
      if (!pattern.test(stringValue)) {
        issues.push(makeIssue(rule, 'pattern', 'Entspricht nicht dem definierten regulären Ausdruck.'));
      }
    } else {
      issues.push(makeIssue(rule, 'schema', `Ungültiger regulärer Ausdruck: ${pattern.message}`));
    }
  }

  if (rule.type === 'number') {
    const numberValue = Number(stringValue);
    if (!Number.isFinite(numberValue)) {
      issues.push(makeIssue(rule, 'type', 'Muss eine gültige Zahl sein.'));
    } else {
      if (rule.min !== null && numberValue < rule.min) {
        issues.push(makeIssue(rule, 'range', `Muss größer oder gleich ${rule.min} sein.`));
      }
      if (rule.max !== null && numberValue > rule.max) {
        issues.push(makeIssue(rule, 'range', `Muss kleiner oder gleich ${rule.max} sein.`));
      }
    }
  } else if (rule.type === 'boolean') {
    if (!['true', 'false', '1', '0'].includes(stringValue.toLowerCase())) {
      issues.push(makeIssue(rule, 'type', 'Muss ein boolescher Wert sein.'));
    }
  } else if (rule.type === 'url') {
    try {
      const url = new URL(stringValue);
      if (!url.protocol) {
        throw new Error('missing protocol');
      }
    } catch {
      issues.push(makeIssue(rule, 'type', 'Muss eine gültige URL sein.'));
    }
  } else if (rule.type === 'email' && !emailPattern.test(stringValue)) {
    issues.push(makeIssue(rule, 'email', 'Muss eine gültige E-Mail-Adresse sein.'));
  } else if (rule.type === 'json') {
    const result = parseJson(stringValue);
    if (!result.valid) {
      issues.push(makeIssue(rule, 'json', 'Muss gültiges JSON sein.'));
    }
  }

  if (rule.minLength !== null && stringValue.length < rule.minLength) {
    issues.push(makeIssue(rule, 'length', `Muss mindestens ${rule.minLength} Zeichen lang sein.`));
  }
  if (rule.maxLength !== null && stringValue.length > rule.maxLength) {
    issues.push(makeIssue(rule, 'length', `Darf höchstens ${rule.maxLength} Zeichen lang sein.`));
  }

  if (rule.secret) {
    const reasons = isWeakSecret(stringValue, rule.minLength);
    if (reasons.length > 0) {
      warnings.push(makeIssue(rule, 'weak_secret', `Schwaches Geheimnis: ${reasons.join(', ')}.`));
    }
  }

  return { issues, warnings };
}

export function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Schema muss ein Objekt sein.');
  }

  return Object.fromEntries(
    Object.entries(schema).map(([key, meta]) => [key, normalizeRule(key, meta)])
  );
}

export function validateEnv(schema, currentEnv = {}, options = {}) {
  const rules = options.normalized ? schema : normalizeSchema(schema);
  const errors = [];
  const warnings = [];

  for (const rule of Object.values(rules)) {
    const result = validateValue(rule, currentEnv[rule.key]);
    errors.push(...result.issues);
    warnings.push(...result.warnings);
  }

  return {
    valid: errors.length === 0 && (!options.strictWarnings || warnings.length === 0),
    errors,
    warnings,
    summary: {
      checked: Object.keys(rules).length,
      errors: errors.length,
      warnings: warnings.length
    }
  };
}

export { isWeakSecret, normalizeRule };
