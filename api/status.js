import { vercelAdapter } from '../src/vercel.js';
import { handleStatus } from '../src/handlers.js';

export default vercelAdapter(handleStatus, { methods: ['GET'] });
