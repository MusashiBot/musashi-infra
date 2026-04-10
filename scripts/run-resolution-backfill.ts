import { bootstrapScriptEnv } from '../src/lib/script-runtime.js';
import { backfillResolutions } from '../src/jobs/resolution-backfill.js';

await bootstrapScriptEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);

const result = await backfillResolutions();
console.log(JSON.stringify(result, null, 2));
