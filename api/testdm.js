import { vercelAdapter } from '../src/vercel.js';
import { handleTestDm } from '../src/handlers.js';

// Send one test DM (admin-gated) to verify the DM flow/selectors.
export default vercelAdapter(handleTestDm, { methods: ['POST'] });
