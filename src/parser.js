import fs from 'node:fs';

export function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const result = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const [keyVar, ...rest] = trimmed.split('=');
    const key = keyVar.trim();
    const rawValueWithComment = rest.join('=').trim();

    // Extrahiere Wert und Typ-Kommentar (z. B. "3000 # type: number")
    const [value, comment] = rawValueWithComment.split('#');
    const expectedType = comment?.match(/type:\s*(\w+)/i)?.[1]?.toLowerCase() || 'string';

    result[key] = {
      value: value?.trim() || '',
      type: expectedType
    };
  }

  return result;
}