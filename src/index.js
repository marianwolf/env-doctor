import { parseEnvFile } from './parser.js';
import { validateEnv } from './validator.js';

export function diagnose(examplePath = '.env.example', envPath = '.env') {
  const schema = parseEnvFile(examplePath);
  
  if (!schema) {
    throw new Error(`Vorlage "${examplePath}" wurde nicht gefunden.`);
  }

  const targetEnv = parseEnvFile(envPath);
  
  // Nutzt Werte aus der .env-Datei oder fällt auf process.env zurück
  const actualValues = {};
  for (const key of Object.keys(schema)) {
    actualValues[key] = targetEnv?.[key]?.value ?? process.env[key];
  }

  return validateEnv(schema, actualValues);
}