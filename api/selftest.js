import { vercelAdapter } from '../src/vercel.js';
import { handleSelfTest } from '../src/handlers.js';

// Connection & selector self-test (admin-gated). Launches the browser, so it
// needs the same memory/duration as the cron functions (see vercel.json).
export default vercelAdapter(handleSelfTest, { methods: ['POST'] });
