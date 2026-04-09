import { bootstrapScriptEnv } from '../src/lib/script-runtime.js';
import { runFullSync } from '../src/jobs/full-sync.js';

await bootstrapScriptEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);

const result = await runFullSync();
console.log(JSON.stringify(result, null, 2));
