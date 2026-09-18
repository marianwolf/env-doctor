import fs from 'node:fs';
import { parse as parseDotenv } from 'dotenv';

const assignmentPattern = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/;
const directivePattern = /(?:^|\s)(type|required|optional|enum|pattern|regex|min|max|minlength|maxlength|email|json|format|secret|sensitive|default)\s*:/gi;

function parseBoolean(value) {
  return ['true', 'yes', '1', 'on'].includes(String(value).trim().toLowerCase());
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findCommentStart(line) {
  let quote = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (quote === '"' && character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '#') {
      return index;
    }
  }

  return -1;
}

function parseDirectives(comment) {
  const text = String(comment || '').replace(/^#*\s*/, '');
  const matches = [...text.matchAll(directivePattern)];
  const directives = {};

  matches.forEach((match, index) => {
    const name = match[1].toLowerCase();
    const next = matches[index + 1]?.index ?? text.length;
    const rawValue = text.slice(match.index + match[0].length, next).trim();

    if (name === 'type' || name === 'format') {
      directives.type = rawValue.toLowerCase();
    } else if (name === 'required') {
      directives.required = parseBoolean(rawValue);
    } else if (name === 'optional') {
      directives.required = !parseBoolean(rawValue);
    } else if (name === 'enum') {
      directives.enum = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
    } else if (name === 'pattern' || name === 'regex') {
      directives.pattern = rawValue;
    } else if (name === 'min') {
      directives.min = parseNumber(rawValue);
    } else if (name === 'max') {
      directives.max = parseNumber(rawValue);
    } else if (name === 'minlength') {
      directives.minLength = Number.parseInt(rawValue, 10);
    } else if (name === 'maxlength') {
      directives.maxLength = Number.parseInt(rawValue, 10);
    } else if (['email', 'json', 'secret', 'sensitive'].includes(name)) {
      directives[name === 'sensitive' ? 'secret' : name] = rawValue === '' || parseBoolean(rawValue);
    } else if (name === 'default') {
      directives.default = rawValue;
    }
  });

  return directives;
}

function updateQuoteState(value, state = { quote: null, escaped: false }) {
  for (const character of value) {
    if (state.quote) {
      if (state.escaped) {
        state.escaped = false;
      } else if (state.quote === '"' && character === '\\') {
        state.escaped = true;
      } else if (character === state.quote) {
        state.quote = null;
      }
    } else if (character === '"' || character === "'") {
      state.quote = character;
    }
  }

  return state;
}

function scanAssignments(content) {
  const assignments = [];
  const lines = content.split(/\r?\n/);
  let multilineKey = null;
  const quoteState = { quote: null, escaped: false };

  lines.forEach((line, index) => {
    if (multilineKey) {
      updateQuoteState(line, quoteState);
      if (!quoteState.quote) {
        multilineKey = null;
      }
      return;
    }

    const match = line.match(assignmentPattern);
    if (!match) {
      return;
    }

    const key = match[1];
    const commentStart = findCommentStart(line);
    const comment = commentStart >= 0 ? line.slice(commentStart) : '';
    const valueStart = match[0].length;
    const valueEnd = commentStart >= 0 ? commentStart : line.length;
    const value = line.slice(valueStart, valueEnd);

    assignments.push({
      key,
      line,
      lineNumber: index + 1,
      comment,
      directives: parseDirectives(comment)
    });
    updateQuoteState(value, quoteState);
    if (quoteState.quote) {
      multilineKey = key;
    }
  });

  return assignments;
}

export function parseEnvContent(content, options = {}) {
  const filePath = options.filePath || '<memory>';
  const parsedValues = parseDotenv(content);
  const assignments = scanAssignments(content);
  const entries = {};
  const duplicates = [];

  assignments.forEach((assignment) => {
    const previous = entries[assignment.key];
    const metadata = {
      value: parsedValues[assignment.key] ?? '',
      type: 'string',
      required: true,
      ...assignment.directives,
      source: filePath,
      line: assignment.lineNumber
    };

    if (previous) {
      duplicates.push({
        key: assignment.key,
        firstLine: previous.line,
        line: assignment.lineNumber,
        source: filePath
      });
    }

    entries[assignment.key] = metadata;
  });

  return {
    path: filePath,
    values: Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry.value])),
    entries,
    duplicates,
    parseErrors: []
  };
}

export function parseEnvFileDetailed(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return parseEnvContent(fs.readFileSync(filePath, 'utf8'), { filePath });
}

export function parseEnvFile(filePath, options = {}) {
  const detailed = parseEnvFileDetailed(filePath);
  if (!detailed) {
    return null;
  }

  if (options.detailed) {
    return detailed;
  }

  return Object.fromEntries(
    Object.entries(detailed.entries).map(([key, entry]) => [
      key,
      {
        value: entry.value,
        type: entry.type
      }
    ])
  );
}

export { parseDirectives };
