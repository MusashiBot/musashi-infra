import { bootstrapScriptEnv } from '../src/lib/script-runtime.js';
import { runGapDetection } from '../src/jobs/gap-detection.js';

await bootstrapScriptEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);

const result = await runGapDetection();
console.log(JSON.stringify(result, null, 2));
