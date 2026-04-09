import { bootstrapScriptEnv } from '../src/lib/script-runtime.js';
import { advanceCrawl } from '../src/jobs/crawl-advance.js';

await bootstrapScriptEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);

const result = await advanceCrawl();
console.log(JSON.stringify(result, null, 2));
