import { vercelAdapter } from '../../src/vercel.js';
import { handleCronWorker } from '../../src/handlers.js';

// Hit frequently by Vercel Cron to drain the mass-DM queue a batch at a time.
export default vercelAdapter(handleCronWorker, { methods: ['GET', 'POST'] });
