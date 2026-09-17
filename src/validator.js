export function validateEnv(schema, currentEnv) {
  const errors = [];
  const warnings = [];

  for (const [key, meta] of Object.entries(schema)) {
    const actualValue = currentEnv[key];

    // 1. Fehlende Variable
    if (actualValue === undefined || actualValue === '') {
      errors.push({ key, message: `Fehlt vollständig in der Umgebung.` });
      continue;
    }

    // 2. Typ-Validierung
    if (meta.type === 'number' && isNaN(Number(actualValue))) {
      errors.push({ key, message: `Erwartet Typ 'number', erhalten: "${actualValue}"` });
    } else if (meta.type === 'boolean' && !['true', 'false', '1', '0'].includes(actualValue.toLowerCase())) {
      errors.push({ key, message: `Erwartet Typ 'boolean', erhalten: "${actualValue}"` });
    } else if (meta.type === 'url') {
      try {
        new URL(actualValue);
      } catch {
        errors.push({ key, message: `Erwartet gültige URL, erhalten: "${actualValue}"` });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}