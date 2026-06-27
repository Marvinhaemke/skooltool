/**
 * Adapter that turns a transport-agnostic handler (from src/handlers.js) into a
 * Vercel/Node serverless function `(req, res)`.
 */
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    // Vercel parses JSON bodies for the Node runtime.
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body;
  }
  // Fallback: read the raw stream.
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

export function vercelAdapter(handler, { methods } = {}) {
  return async (req, res) => {
    try {
      if (methods && !methods.includes(req.method)) {
        res.status(405).json({ error: 'method not allowed' });
        return;
      }
      const body = req.method === 'GET' ? {} : await readBody(req);
      const { status, body: out } = await handler({ headers: req.headers, body });
      res.status(status).json(out);
    } catch (err) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  };
}
