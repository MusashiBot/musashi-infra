import { bootstrapScriptEnv } from '../src/lib/script-runtime.js';
import { runResolutionCheck } from '../src/jobs/resolution-check.js';

await bootstrapScriptEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);

const result = await runResolutionCheck();
console.log(JSON.stringify(result, null, 2));
