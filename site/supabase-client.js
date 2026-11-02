(() => {
  const config = window.VOZIA_CONFIG || {};
  const base = String(config.supabaseUrl || '').replace(/\/+$/, '');
  const key = config.supabasePublishableKey || '';
  const storageKey = 'vozia.auth.session';

  function readSession() {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); }
    catch { return null; }
  }
  function saveSession(session) {
    if (!session?.access_token) { localStorage.removeItem(storageKey); return null; }
    const next = { ...session, expires_at: session.expires_at || (Date.now() / 1000 + (Number(session.expires_in) || 3600)) };
    localStorage.setItem(storageKey, JSON.stringify(next));
    return next;
  }
  async function parse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.msg || data.message || data.error_description || data.error || `Solicitação recusada (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function requireConfig() {
    if (!base || !key) throw new Error('A conexão do Supabase não está configurada nesta página.');
  }
  async function auth(path, body, method = 'POST', token = '') {
    requireConfig();
    const response = await fetch(`${base}/auth/v1/${path}`, {
      method,
      headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return parse(response);
  }
  async function validSession() {
    const session = readSession();
    if (!session?.access_token) return null;
    if (Number(session.expires_at) > Date.now() / 1000 + 45) return session;
    if (!session.refresh_token) { saveSession(null); return null; }
    try {
      const refreshed = await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
      return saveSession(refreshed);
    } catch {
      saveSession(null);
      return null;
    }
  }
  async function rest(path, { method = 'GET', body, authRequired = true, headers = {} } = {}) {
    requireConfig();
    const session = authRequired ? await validSession() : null;
    if (authRequired && !session) throw new Error('Sua sessão expirou. Entre novamente.');
    const response = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return parse(response);
  }

  window.VoziaAuth = {
    readSession,
    saveSession,
    validSession,
    signUp: async ({ email, password, name }) => {
      const result = await auth(`signup?redirect_to=${encodeURIComponent(`${location.origin}/login?confirmed=1`)}`, {
        email,
        password,
        data: { full_name: name }
      });
      if (result.access_token) saveSession(result);
      return result;
    },
    signIn: async ({ email, password }) => saveSession(await auth('token?grant_type=password', { email, password })),
    recover: email => auth(`recover?redirect_to=${encodeURIComponent(`${location.origin}/reset-password`)}`, { email }),
    updatePassword: async password => {
      const session = await validSession();
      if (!session) throw new Error('O link de recuperação expirou. Solicite outro e-mail.');
      return auth('user', { password }, 'PUT', session.access_token);
    },
    getUser: async () => {
      const session = await validSession();
      if (!session) return null;
      return auth('user', undefined, 'GET', session.access_token);
    },
    signOut: async () => {
      const session = await validSession();
      try { if (session) await auth('logout', undefined, 'POST', session.access_token); }
      finally { saveSession(null); }
    },
    getProfile: async userId => {
      const rows = await rest(`profiles?select=id,display_name,role,created_at&id=eq.${encodeURIComponent(userId)}&limit=1`);
      return rows[0] || null;
    },
    rest
  };
})();
