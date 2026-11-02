const { Readable } = require('node:stream');

async function transcriptionApi(req, res) {
  const configuredUrl = String(process.env.VOZIA_API_URL || '').trim();
  if (!configuredUrl) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({
      error: 'O servidor Whisper ainda não está conectado. Configure VOZIA_API_URL com o endereço público do servidor Vozia.'
    }));
    return;
  }

  let base;
  let target;
  try {
    base = new URL(configuredUrl);
    if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
      throw new Error('Use HTTPS para o servidor Whisper.');
    }
    target = new URL(req.url, `${base.origin}/`);
    if (target.origin !== base.origin || !target.pathname.startsWith('/api/')) {
      throw new Error('Rota de API inválida.');
    }
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: error.message || 'VOZIA_API_URL inválida.' }));
    return;
  }

  const headers = {};
  for (const name of ['accept', 'authorization', 'content-type', 'content-length', 'range', 'if-range']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }

  try {
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      ...(hasBody ? { body: req, duplex: 'half' } : {})
    });

    res.statusCode = upstream.status;
    for (const name of ['content-type', 'content-length', 'content-disposition', 'content-range', 'accept-ranges', 'cache-control']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch {
    if (res.headersSent) return res.destroy();
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Não foi possível alcançar o servidor Whisper. Confira se o serviço está ativo e se VOZIA_API_URL está correto.' }));
  }
}

module.exports = transcriptionApi;
module.exports.config = { api: { bodyParser: false } };
