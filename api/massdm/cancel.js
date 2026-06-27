import { vercelAdapter } from '../../src/vercel.js';
import { handleCancelMassDm } from '../../src/handlers.js';

export default vercelAdapter(handleCancelMassDm, { methods: ['POST'] });
