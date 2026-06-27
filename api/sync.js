import { vercelAdapter } from '../src/vercel.js';
import { handleSync } from '../src/handlers.js';

// Manual sync trigger (admin-gated). The scheduled one is api/cron/sync.js.
export default vercelAdapter(handleSync, { methods: ['POST'] });
