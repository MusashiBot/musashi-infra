import { findMissingEnv, formatMissingEnvMessage } from '../src/lib/required-env.js';

const requiredNames = process.argv.slice(2);

if (requiredNames.length === 0) {
  throw new Error('Pass one or more environment variable names to check-required-env.');
}

const missing = findMissingEnv(requiredNames);

if (missing.length > 0) {
  console.error(formatMissingEnvMessage(missing, 'ci'));
  process.exitCode = 1;
} else {
  console.log(`Environment preflight passed for: ${requiredNames.join(', ')}`);
}
