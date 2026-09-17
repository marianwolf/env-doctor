#!/usr/bin/env node
import { diagnose } from '../src/index.js';

console.log('🩺 env-doctor analysiert deine Umgebungsvariablen...\n');

try {
  const report = diagnose('.env.example', '.env');

  if (report.valid) {
    console.log('✅ Alle Umgebungsvariablen sind vollständig und gültig!');
    process.exit(0);
  } else {
    console.error('❌ Fehler in den Umgebungsvariablen gefunden:\n');
    report.errors.forEach(err => {
      console.error(` ✖ [${err.key}]: ${err.message}`);
    });
    process.exit(1);
  }
} catch (error) {
  console.error(`🚨 Fehler: ${error.message}`);
  process.exit(1);
}