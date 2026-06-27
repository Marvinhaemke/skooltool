import { handleGetConfig, handleSaveConfig } from '../src/handlers.js';

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

export default async function handler(req, res) {
  try {
    const isGet = req.method === 'GET';
    const body = isGet ? {} : await readBody(req);
    const result = isGet
      ? await handleGetConfig({ headers: req.headers, body })
      : await handleSaveConfig({ headers: req.headers, body });
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}
