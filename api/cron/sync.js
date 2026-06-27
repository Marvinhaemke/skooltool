import { vercelAdapter } from '../../src/vercel.js';
import { handleCronSync } from '../../src/handlers.js';

// Hit daily by Vercel Cron (see vercel.json). Auth: Bearer CRON_SECRET.
export default vercelAdapter(handleCronSync, { methods: ['GET', 'POST'] });
