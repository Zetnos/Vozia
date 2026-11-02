const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const configured = () => Boolean(baseUrl && publishableKey && serviceKey);
const authUrl = path => `${baseUrl}/auth/v1/${path}`;
const restUrl = path => `${baseUrl}/rest/v1/${path}`;

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const error = new Error(body.msg || body.message || body.error_description || body.error || `Supabase respondeu ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function apiHeaders(token = publishableKey, extra = {}) {
  return { apikey: publishableKey, Authorization: `Bearer ${token}`, ...extra };
}

async function auth(path, { method = 'GET', body, token } = {}) {
  if (!configured()) throw new Error('Supabase não configurado. Defina SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY e SUPABASE_SERVICE_ROLE_KEY no .env.');
  return requestJson(authUrl(path), {
    method,
    headers: apiHeaders(token || publishableKey, body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function getUser(accessToken) {
  return auth('user', { token: accessToken });
}

async function refreshSession(refreshToken) {
  return auth('token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } });
}

async function database(path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  if (!configured()) throw new Error('Supabase não configurado.');
  const headers = { apikey: serviceKey, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(prefer ? { Prefer: prefer } : {}) };
  if (!serviceKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${serviceKey}`;
  return requestJson(restUrl(path), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function setSessionCookies(res, session) {
  const secure = process.env.NODE_ENV === 'production' || String(process.env.PUBLIC_URL || '').startsWith('https://') ? '; Secure' : '';
  const accessAge = Math.max(60, Number(session.expires_in) || 3600);
  const refreshAge = 60 * 60 * 24 * 30;
  res.setHeader('Set-Cookie', [
    `vozia_access=${encodeURIComponent(session.access_token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${accessAge}${secure}`,
    `vozia_refresh=${encodeURIComponent(session.refresh_token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${refreshAge}${secure}`
  ]);
}

function clearSessionCookies(res) {
  const secure = process.env.NODE_ENV === 'production' || String(process.env.PUBLIC_URL || '').startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `vozia_access=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    `vozia_refresh=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
  ]);
}

function readCookie(req, name) {
  for (const pair of String(req.headers.cookie || '').split(';')) {
    const split = pair.trim().indexOf('=');
    if (split < 0 || pair.slice(0, split) !== name) continue;
    try { return decodeURIComponent(pair.slice(split + 1)); } catch { return ''; }
  }
  return '';
}

async function authenticate(req, res) {
  if (!configured()) return null;
  const accessToken = readCookie(req, 'vozia_access');
  const refreshToken = readCookie(req, 'vozia_refresh');
  if (accessToken) {
    try {
      const user = await getUser(accessToken);
      return { user, accessToken };
    } catch (error) {
      if (![401, 403].includes(error.status) || !refreshToken) return null;
    }
  }
  if (!refreshToken) return null;
  try {
    const session = await refreshSession(refreshToken);
    setSessionCookies(res, session);
    return { user: session.user || await getUser(session.access_token), accessToken: session.access_token };
  } catch {
    clearSessionCookies(res);
    return null;
  }
}

function safeMessage(error) {
  if (error.status === 401 || error.status === 403) return 'E-mail ou senha inválidos.';
  return error.message || 'Não foi possível concluir a operação no Supabase.';
}

module.exports = {
  configured,
  auth,
  database,
  getUser,
  authenticate,
  setSessionCookies,
  clearSessionCookies,
  safeMessage
};
