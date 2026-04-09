import { loadRuntimeEnv } from './runtime-env.js';

export async function bootstrapScriptEnv(
  requiredNames: string[],
  options?: {
    envFileUrl?: URL;
  },
): Promise<void> {
  const envFileUrl = options?.envFileUrl ?? new URL('../../.env', import.meta.url);
  const runtimeEnv = await loadRuntimeEnv(envFileUrl);

  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  const missing = requiredNames.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
        'Create a .env file in the repo root or set them in your shell.',
    );
  }
}
