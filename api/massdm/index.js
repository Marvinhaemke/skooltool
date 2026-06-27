import { vercelAdapter } from '../../src/vercel.js';
import { handleMassDm } from '../../src/handlers.js';

// Enqueue a mass-DM job (admin-gated). The cron worker drains it over time.
export default vercelAdapter(handleMassDm, { methods: ['POST'] });
