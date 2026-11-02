const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { pipeline } = require('node:stream/promises');
const root = __dirname;
const dataDir = path.join(root, 'uploads');
// Stay below Vercel's serverless request body ceiling when chunks pass through
// the same-origin API proxy.
const chunkSize = 4 * 1024 * 1024;
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
const supabase = require('./supabase');
const pythonPath = process.env.PYTHON_EXECUTABLE || path.join(root, '.venv', 'Scripts', 'python.exe');
let whisperModel = process.env.WHISPER_MODEL || 'base';
let adminPassword = process.env.ADMIN_PASSWORD || '';
let transcriptionQueue = Promise.resolve();
const adminSessions = new Map();
const loginAttempts = new Map();
const supportedModels = ['tiny', 'base', 'small', 'medium', 'large', 'turbo'];
fs.mkdirSync(dataDir, { recursive: true });

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function requestOrigin(req) {
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}`;
}
function matchesSecret(candidate, expected) { const a = Buffer.from(String(candidate)); const b = Buffer.from(String(expected)); return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b); }
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', part => { raw += part; if (raw.length > 20000) reject(new Error('Metadata too large')); });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(x => x.length === 2)); }
function isAdmin(req) { const session = adminSessions.get(cookies(req).vozia_admin); return !!session && session > Date.now(); }
function safeJob(dir, id) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
    const audio = path.join(dir, 'audio-upload');
    return { id, name: meta.name || 'Áudio', project: meta.project || 'Sem projeto', size: meta.size || 0, language: meta.language || 'auto', status: meta.transcriptionStatus || 'uploading', createdAt: meta.createdAt || null, transcript: meta.transcription || '', error: meta.transcriptionError || null, hasAudio: fs.existsSync(audio) };
  } catch { return null; }
}
function listJobs() { return fs.readdirSync(dataDir, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => safeJob(path.join(dataDir, x.name), x.name)).filter(Boolean).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); }
function requireAdmin(req, res) { if (!isAdmin(req)) { send(res, 401, { error: 'Sessão administrativa expirada.' }); return false; } return true; }
function rowToJob(row) {
  return { id: row.id, userId: row.user_id, name: row.name, project: row.project, size: Number(row.size_bytes || 0), language: row.language, status: row.status, createdAt: row.created_at, transcript: row.transcript || '', segments: Array.isArray(row.segments) ? row.segments : [], detectedLanguage: row.detected_language || null, error: row.error || null, favorite: Boolean(row.favorite), hasAudio: fs.existsSync(path.join(dataDir, row.id, 'audio-upload')) };
}
async function getOwnedJob(userId, id) {
  const rows = await supabase.database(`transcriptions?select=*&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows[0] || null;
}
async function getUserJobs(userId) {
  const rows = await supabase.database(`transcriptions?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=500`);
  const jobs = rows.map(rowToJob);
  return { jobs, total: jobs.length, storageBytes: jobs.reduce((sum, job) => sum + job.size, 0) };
}
async function updateJobRecord(id, patch) {
  await supabase.database(`transcriptions?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
}
async function requireUser(req, res) {
  if (!supabase.configured()) { send(res, 503, { error: 'Supabase não configurado no servidor. Preencha as variáveis SUPABASE_* no .env e reinicie o processo.' }); return null; }
  try {
    const session = await supabase.authenticate(req, res);
    if (!session?.user?.id) { send(res, 401, { error: 'Faça login para acessar este recurso.', code: 'AUTH_REQUIRED' }); return null; }
    return session;
  } catch (error) { send(res, 503, { error: supabase.safeMessage(error) }); return null; }
}
function persistSetting(key, value) {
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const prefix = `${key}=`;
  const next = lines.filter(line => !line.startsWith(prefix)); next.push(`${prefix}${value}`);
  fs.writeFileSync(envFile, `${next.join('\n')}\n`, { mode: 0o600 });
}
function buildCaptionCues(segments) {
  const allWords = segments.flatMap(segment => Array.isArray(segment.words) ? segment.words : []);
  if (!allWords.length) return segments.map(segment => ({ start: segment.start, end: segment.end, text: segment.text.trim() }));
  const cues = []; let current = [];
  const flush = () => { if (!current.length) return; const text = current.map(word => word.text).join('').trim(); if (text) cues.push({ start: current[0].start, end: current[current.length - 1].end, text }); current = []; };
  for (const word of allWords) {
    const candidate = current.map(item => item.text).join('') + word.text;
    const elapsed = current.length ? Number(word.end) - Number(current[0].start) : 0;
    if (current.length && (elapsed > 5.5 || candidate.trim().length > 84)) flush();
    current.push(word);
    const text = current.map(item => item.text).join('').trim();
    if (Number(word.end) - Number(current[0].start) >= 1.2 && /[.!?…][\"'»)]?$/.test(text)) flush();
  }
  flush(); return cues;
}
function captionTime(seconds, separator) { const ms = Math.max(0, Math.round(Number(seconds) * 1000)); const h = Math.floor(ms / 3600000); const m = Math.floor(ms % 3600000 / 60000); const s = Math.floor(ms % 60000 / 1000); const milli = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${separator}${String(milli).padStart(3, '0')}`; }

async function transcribeUpload(dir) {
  const metadataPath = path.join(dir, 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const source = path.join(dir, 'audio-upload');
  metadata.transcriptionStatus = 'loading_model';
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  await updateJobRecord(path.basename(dir), { status: 'loading_model', error: null });
  const language = ({ 'pt-BR': 'pt', 'en-US': 'en', 'es-ES': 'es', 'fr-FR': 'fr', 'de-DE': 'de', 'it-IT': 'it', 'ja-JP': 'ja' })[metadata.language] || 'auto';
  let stdout;
  try {
    ({ stdout } = await execFile(pythonPath, [path.join(root, 'whisper_worker.py'), source, language, whisperModel], { windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } }));
  } catch (error) {
    let detail = '';
    try { detail = JSON.parse(error.stdout || '').error || ''; } catch {}
    if (!detail) detail = (error.stderr || error.message || 'Erro desconhecido no Whisper').replace(/\x1b\[[0-9;]*m/g, '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
    throw new Error(detail.slice(0, 700));
  }
  const result = JSON.parse(stdout);
  if (typeof result.text !== 'string') throw new Error(result.error || 'O Whisper não retornou uma transcrição.');
  metadata.transcription = result.text;
  metadata.transcriptionSegments = Array.isArray(result.segments) ? result.segments : [];
  metadata.detectedLanguage = result.language;
  metadata.transcriptionStatus = 'completed';
  delete metadata.transcriptionError;
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  await updateJobRecord(path.basename(dir), { status: 'completed', transcript: metadata.transcription, segments: metadata.transcriptionSegments, detected_language: metadata.detectedLanguage, error: null });
}

function enqueueTranscription(dir) {
  transcriptionQueue = transcriptionQueue.then(async () => {
    try { await transcribeUpload(dir); }
    catch (error) {
      const metaPath = path.join(dir, 'metadata.json');
      try { const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')); metadata.transcriptionStatus = 'failed'; metadata.transcriptionError = error.message; fs.writeFileSync(metaPath, JSON.stringify(metadata)); } catch {}
      try { await updateJobRecord(path.basename(dir), { status: 'failed', error: error.message }); } catch {}
    }
  });
  return transcriptionQueue;
}

async function resumeInterruptedJobs() {
  if (!supabase.configured()) return;
  const pending = fs.readdirSync(dataDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(dataDir, entry.name))
    .filter(dir => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
        return ['queued', 'loading_model', 'transcribing'].includes(meta.transcriptionStatus) && fs.existsSync(path.join(dir, 'audio-upload'));
      } catch { return false; }
    });
  for (const dir of pending) {
    const metaPath = path.join(dir, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    metadata.transcriptionStatus = 'queued';
    fs.writeFileSync(metaPath, JSON.stringify(metadata));
    try { await updateJobRecord(path.basename(dir), { status: 'queued', error: null }); } catch {}
  }
  for (const dir of pending) enqueueTranscription(dir);
  return transcriptionQueue;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      try { await execFile(pythonPath, ['-c', 'import whisper'], { windowsHide: true, timeout: 30000 }); return send(res, 200, { server: 'ok', whisperInstalled: true, model: whisperModel }); }
      catch { return send(res, 200, { server: 'ok', whisperInstalled: false, model: whisperModel }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, { supabaseConfigured: supabase.configured(), requiresAuth: true, transcriptionEngine: 'whisper-server' });
    if (url.pathname.startsWith('/api/auth/')) {
      if (!supabase.configured()) return send(res, 503, { error: 'Supabase não configurado. Defina as variáveis SUPABASE_* no .env.' });
      try {
        if (url.pathname === '/api/auth/register' && req.method === 'POST') {
          const body = await readJson(req); const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || ''); const name = String(body.name || '').trim().slice(0, 80);
          if (!email || password.length < 8 || password.length > 128 || !name) return send(res, 400, { error: 'Informe nome, e-mail válido e uma senha com pelo menos 8 caracteres.' });
          const redirectTo = `${requestOrigin(req)}/login?confirmed=1`;
          const result = await supabase.auth(`signup?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email, password, data: { full_name: name } } });
          if (result.access_token && result.refresh_token) { supabase.setSessionCookies(res, result); return send(res, 201, { ok: true, authenticated: true, user: result.user }); }
          return send(res, 201, { ok: true, authenticated: false, emailConfirmationRequired: true, email });
        }
        if (url.pathname === '/api/auth/login' && req.method === 'POST') {
          const body = await readJson(req); const result = await supabase.auth('token?grant_type=password', { method: 'POST', body: { email: String(body.email || '').trim().toLowerCase(), password: String(body.password || '') } });
          supabase.setSessionCookies(res, result); return send(res, 200, { ok: true, user: result.user });
        }
        if (url.pathname === '/api/auth/session' && req.method === 'GET') {
          const session = await requireUser(req, res); if (!session) return;
          return send(res, 200, { user: session.user });
        }
        if (url.pathname === '/api/auth/recovery-session' && req.method === 'POST') {
          const body = await readJson(req);
          if (!body.accessToken || !body.refreshToken) return send(res, 400, { error: 'Link de recuperação inválido ou expirado.' });
          await supabase.getUser(String(body.accessToken));
          supabase.setSessionCookies(res, { access_token: body.accessToken, refresh_token: body.refreshToken, expires_in: 3600 });
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
          const session = await supabase.authenticate(req, res);
          if (session) { try { await supabase.auth('logout', { method: 'POST', token: session.accessToken }); } catch {} }
          supabase.clearSessionCookies(res); return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/auth/recover' && req.method === 'POST') {
          const body = await readJson(req); const email = String(body.email || '').trim().toLowerCase();
          if (!email) return send(res, 400, { error: 'Informe o e-mail da conta.' });
          const redirectTo = `${requestOrigin(req)}/reset-password`;
          await supabase.auth(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email } });
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/auth/password' && req.method === 'PUT') {
          const session = await requireUser(req, res); if (!session) return;
          const body = await readJson(req); const password = String(body.password || '');
          if (password.length < 8 || password.length > 128) return send(res, 400, { error: 'A senha precisa ter entre 8 e 128 caracteres.' });
          await supabase.auth('user', { method: 'PUT', body: { password }, token: session.accessToken });
          return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: 'Rota de autenticação não encontrada.' });
      } catch (error) { return send(res, error.status && error.status < 500 ? error.status : 502, { error: supabase.safeMessage(error) }); }
    }
    if (url.pathname === '/api/me' && (req.method === 'GET' || req.method === 'PATCH')) {
      const session = await requireUser(req, res); if (!session) return;
      try {
        if (req.method === 'GET') {
          const rows = await supabase.database(`profiles?select=id,display_name,created_at&id=eq.${encodeURIComponent(session.user.id)}&limit=1`);
          return send(res, 200, { user: session.user, profile: rows[0] || { id: session.user.id, display_name: session.user.user_metadata?.full_name || '' } });
        }
        const body = await readJson(req); const displayName = String(body.displayName || '').trim().slice(0, 80);
        if (!displayName) return send(res, 400, { error: 'Informe um nome de exibição.' });
        const rows = await supabase.database('profiles?on_conflict=id', { method: 'POST', body: { id: session.user.id, display_name: displayName, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=representation' });
        await supabase.auth('user', { method: 'PUT', body: { data: { ...session.user.user_metadata, full_name: displayName } }, token: session.accessToken });
        return send(res, 200, { profile: rows[0] || { id: session.user.id, display_name: displayName } });
      } catch (error) { return send(res, 502, { error: supabase.safeMessage(error) }); }
    }
    const workspaceRoute = url.pathname.match(/^\/api\/workspace(?:\/[\da-f-]{36})?\/jobs$/i);
    if (req.method === 'GET' && workspaceRoute) {
      const session = await requireUser(req, res); if (!session) return;
      try { return send(res, 200, await getUserJobs(session.user.id)); }
      catch (error) { return send(res, 502, { error: supabase.safeMessage(error) }); }
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (url.pathname === '/api/admin/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'local'; const now = Date.now(); const attempts = (loginAttempts.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
        if (attempts.length >= 8) return send(res, 429, { error: 'Muitas tentativas. Aguarde 10 minutos.' });
        const body = await readJson(req); const submitted = String(body.password || '');
        if (!matchesSecret(submitted, adminPassword)) { attempts.push(now); loginAttempts.set(ip, attempts); return send(res, 401, { error: 'Senha inválida.' }); }
        loginAttempts.delete(ip); const token = crypto.randomBytes(32).toString('base64url'); adminSessions.set(token, now + 12 * 60 * 60 * 1000);
        res.writeHead(200, { 'Set-Cookie': `vozia_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=43200`, 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: true }));
      }
      if (url.pathname === '/api/admin/me' && req.method === 'GET') return send(res, 200, { authenticated: isAdmin(req), configured: !!adminPassword });
      if (url.pathname === '/api/admin/logout' && req.method === 'POST') { adminSessions.delete(cookies(req).vozia_admin); res.writeHead(200, { 'Set-Cookie': 'vozia_admin=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0', 'Content-Type': 'application/json; charset=utf-8' }); return res.end('{"ok":true}'); }
      if (!requireAdmin(req, res)) return;
      if (url.pathname === '/api/admin/overview' && req.method === 'GET') {
        const jobs = listJobs(); return send(res, 200, { model: whisperModel, python: pythonPath, whisperInstalled: fs.existsSync(pythonPath), storageBytes: jobs.reduce((n, x) => n + x.size, 0), total: jobs.length, queued: jobs.filter(x => x.status === 'queued' || x.status === 'loading_model').length, completed: jobs.filter(x => x.status === 'completed').length, failed: jobs.filter(x => x.status === 'failed').length, recent: jobs.slice(0, 5) });
      }
      if (url.pathname === '/api/admin/jobs' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').toLocaleLowerCase(); const status = url.searchParams.get('status') || 'all';
        return send(res, 200, { jobs: listJobs().filter(x => (status === 'all' || x.status === status) && `${x.name} ${x.project} ${x.id}`.toLocaleLowerCase().includes(q)) });
      }
      if (url.pathname === '/api/admin/settings' && req.method === 'GET') return send(res, 200, { model: whisperModel, models: supportedModels, chunkSize, host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT) || 3000 });
      if (url.pathname === '/api/admin/settings' && req.method === 'POST') {
        const body = await readJson(req); if (!supportedModels.includes(body.model)) return send(res, 400, { error: 'Modelo não suportado.' });
        whisperModel = body.model; process.env.WHISPER_MODEL = body.model; persistSetting('WHISPER_MODEL', body.model); return send(res, 200, { ok: true, model: whisperModel });
      }
      if (url.pathname === '/api/admin/password' && req.method === 'POST') {
        const body = await readJson(req); const old = String(body.currentPassword || ''); const next = String(body.newPassword || '');
        if (!matchesSecret(old, adminPassword)) return send(res, 401, { error: 'Senha atual incorreta.' });
        if (next.length < 14 || next.length > 200) return send(res, 400, { error: 'A nova senha precisa ter entre 14 e 200 caracteres.' });
        adminPassword = next; process.env.ADMIN_PASSWORD = next; persistSetting('ADMIN_PASSWORD', next); adminSessions.clear(); return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/admin/docs' && req.method === 'GET') return send(res, 200, { baseUrl: '/api', endpoints: [{ method: 'GET', path: '/health', auth: false, description: 'Estado do serviço e disponibilidade do Whisper.' }, { method: 'POST', path: '/uploads', auth: true, description: 'Inicia upload em partes; corpo JSON com name, size, type e language.' }, { method: 'PUT', path: '/uploads/:id/chunks/:index', auth: true, description: 'Envia uma parte binária de até 4 MB.' }, { method: 'POST', path: '/uploads/:id/complete', auth: true, description: 'Finaliza o envio e coloca na fila de transcrição.' }, { method: 'GET', path: '/transcriptions/:id', auth: true, description: 'Consulta texto, idioma detectado e segmentos com marcações de tempo.' }, { method: 'GET', path: '/transcriptions/:id.srt', auth: true, description: 'Baixa a legenda sincronizada no formato SRT.' }, { method: 'GET', path: '/transcriptions/:id.vtt', auth: true, description: 'Entrega WebVTT para exibir as falas como legendas sobre o vídeo.' }, { method: 'GET', path: '/transcriptions/:id/media', auth: true, description: 'Reproduz o arquivo original com suporte a Range para buscar por posição em vídeos grandes.' }, { method: 'GET', path: '/admin/overview', auth: true, description: 'Métricas administrativas.' }, { method: 'GET', path: '/admin/jobs', auth: true, description: 'Lista, filtra e pesquisa trabalhos.' }, { method: 'POST', path: '/admin/jobs/:id/retry', auth: true, description: 'Repete uma transcrição que falhou ou regenera os segmentos de uma transcrição concluída.' }, { method: 'DELETE', path: '/admin/jobs/:id', auth: true, description: 'Apaga áudio e transcrição concluídos ou com falha.' }, { method: 'GET/POST', path: '/admin/settings', auth: true, description: 'Consulta ou altera o modelo Whisper.' }] });
      const jobRoute = url.pathname.match(/^\/api\/admin\/jobs\/([\da-f-]+)(?:\/(retry))?$/i);
      if (jobRoute) {
        const dir = path.join(dataDir, jobRoute[1]); const job = safeJob(dir, jobRoute[1]); if (!job) return send(res, 404, { error: 'Trabalho não encontrado.' });
        if (jobRoute[2] && req.method === 'POST') {
          if (!['failed', 'completed'].includes(job.status)) return send(res, 409, { error: 'Só é possível reprocessar trabalhos concluídos ou com falha.' });
          if (!job.hasAudio) return send(res, 409, { error: 'O arquivo de áudio original não está disponível.' });
          const metaPath = path.join(dir, 'metadata.json'); const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); meta.transcriptionStatus = 'queued'; delete meta.transcriptionError; fs.writeFileSync(metaPath, JSON.stringify(meta));
          setImmediate(() => transcribeUpload(dir).catch(error => { try { const current = JSON.parse(fs.readFileSync(metaPath, 'utf8')); current.transcriptionStatus = 'failed'; current.transcriptionError = error.message; fs.writeFileSync(metaPath, JSON.stringify(current)); } catch {} }));
          return send(res, 202, { ok: true });
        }
        if (req.method === 'DELETE') { if (['queued', 'loading_model', 'transcribing'].includes(job.status)) return send(res, 409, { error: 'Aguarde a transcrição terminar antes de apagar.' }); fs.rmSync(dir, { recursive: true, force: true }); return send(res, 200, { ok: true }); }
      }
      return send(res, 404, { error: 'Rota administrativa não encontrada.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/uploads') {
      const session = await requireUser(req, res); if (!session) return;
      const metadata = await readJson(req);
      if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > 10 * 1024 ** 3) return send(res, 400, { error: 'O arquivo deve ter até 10 GB.' });
      const id = crypto.randomUUID();
      const dir = path.join(dataDir, id);
      fs.mkdirSync(path.join(dir, 'chunks'), { recursive: true });
      const createdAt = new Date().toISOString();
      const record = { id, user_id: session.user.id, name: path.basename(metadata.name || 'audio').slice(0, 255), project: String(metadata.project || 'Nova transcrição').slice(0, 120), size_bytes: metadata.size, media_type: String(metadata.type || 'application/octet-stream').slice(0, 120), language: String(metadata.language || 'auto').slice(0, 20), status: 'uploading', transcript: '', segments: [], created_at: createdAt, updated_at: createdAt };
      try { await supabase.database('transcriptions', { method: 'POST', body: record, prefer: 'return=minimal' }); }
      catch (error) { fs.rmSync(dir, { recursive: true, force: true }); return send(res, 502, { error: supabase.safeMessage(error) }); }
      fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ id, userId: session.user.id, ...metadata, ...record, createdAt, chunkSize }));
      return send(res, 201, { id, chunkSize });
    }
    const match = url.pathname.match(/^\/api\/uploads\/([\da-f-]+)(?:\/chunks\/(\d+)|\/complete)?$/i);
    if (match && req.method === 'PUT' && match[2] !== undefined) {
      const session = await requireUser(req, res); if (!session) return;
      const metaPath = path.join(dataDir, match[1], 'metadata.json');
      if (!fs.existsSync(metaPath)) return send(res, 404, { error: 'Envio não encontrado' });
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.userId !== session.user.id) return send(res, 404, { error: 'Envio não encontrado' });
      const file = path.join(dataDir, match[1], 'chunks', `${Number(match[2])}.part`);
      if (!fs.existsSync(path.dirname(file))) return send(res, 404, { error: 'Envio não encontrado' });
      await pipeline(req, fs.createWriteStream(file));
      return send(res, 200, { ok: true });
    }
    if (match && req.method === 'POST' && url.pathname.endsWith('/complete')) {
      const session = await requireUser(req, res); if (!session) return;
      const dir = path.join(dataDir, match[1]);
      const metaPath = path.join(dir, 'metadata.json');
      if (!fs.existsSync(metaPath)) return send(res, 404, { error: 'Envio não encontrado' });
      const savedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (savedMeta.userId !== session.user.id) return send(res, 404, { error: 'Envio não encontrado' });
      const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
      const count = Math.ceil(metadata.size / chunkSize);
      const chunks = Array.from({ length: count }, (_, i) => path.join(dir, 'chunks', `${i}.part`));
      if (chunks.some(file => !fs.existsSync(file))) return send(res, 400, { error: 'Upload incompleto: faltam partes do arquivo' });
      const out = path.join(dir, 'audio-upload');
      const target = fs.createWriteStream(out);
      for (const chunk of chunks) await pipeline(fs.createReadStream(chunk), target, { end: false });
      target.end();
      await new Promise((resolve, reject) => { target.on('finish', resolve); target.on('error', reject); });
      if (fs.statSync(out).size !== metadata.size) return send(res, 400, { error: 'O arquivo recebido não corresponde ao tamanho original' });
      fs.rmSync(path.join(dir, 'chunks'), { recursive: true, force: true });
      metadata.transcriptionStatus = 'queued';
      metadata.transcription = '';
      fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata));
      await updateJobRecord(match[1], { status: 'queued', transcript: '', segments: [], error: null });
      setImmediate(() => enqueueTranscription(dir));
      return send(res, 202, { ok: true, id: match[1], status: 'queued' });
    }
    const statusRoute = url.pathname.match(/^\/api\/transcriptions\/([\da-f-]+)$/i);
    const srtRoute = url.pathname.match(/^\/api\/transcriptions\/([\da-f-]+)\.srt$/i);
    const mediaRoute = url.pathname.match(/^\/api\/transcriptions\/([\da-f-]+)\/media$/i);
    const favoriteRoute = url.pathname.match(/^\/api\/transcriptions\/([\da-f-]+)\/favorite$/i);
    if (favoriteRoute && req.method === 'PATCH') {
      const session = await requireUser(req, res); if (!session) return;
      const job = await getOwnedJob(session.user.id, favoriteRoute[1]); if (!job) return send(res, 404, { error: 'Transcrição não encontrada.' });
      const body = await readJson(req); const favorite = Boolean(body.favorite);
      await updateJobRecord(job.id, { favorite }); return send(res, 200, { favorite });
    }
    if (statusRoute && req.method === 'DELETE') {
      const session = await requireUser(req, res); if (!session) return;
      const job = await getOwnedJob(session.user.id, statusRoute[1]); if (!job) return send(res, 404, { error: 'Transcrição não encontrada.' });
      if (['queued', 'loading_model', 'transcribing'].includes(job.status)) return send(res, 409, { error: 'Aguarde a transcrição terminar antes de apagar.' });
      const dir = path.join(dataDir, statusRoute[1]); if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      await supabase.database(`transcriptions?id=eq.${encodeURIComponent(job.id)}&user_id=eq.${encodeURIComponent(session.user.id)}`, { method: 'DELETE', prefer: 'return=minimal' });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && mediaRoute) {
      const session = await requireUser(req, res); if (!session) return;
      const job = await getOwnedJob(session.user.id, mediaRoute[1]); if (!job) return send(res, 404, { error: 'Arquivo de mídia não encontrado.' });
      const dir = path.join(dataDir, mediaRoute[1]); const file = path.join(dir, 'audio-upload');
      if (!fs.existsSync(file)) return send(res, 404, { error: 'Arquivo de mídia não encontrado.' });
      const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
      const size = fs.statSync(file).size; const requestedType = String(metadata.type || '').toLowerCase();
      const mediaType = /^(audio|video)\/[a-z0-9.+-]+$/.test(requestedType) ? requestedType : 'application/octet-stream';
      const common = { 'Content-Type': mediaType, 'Accept-Ranges': 'bytes', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin' };
      const range = req.headers.range;
      if (!range) { res.writeHead(200, { ...common, 'Content-Length': size }); return fs.createReadStream(file).pipe(res); }
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` }); return res.end(); }
      let start, end;
      if (!match[1]) { const suffix = Number(match[2]); if (!suffix) { res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` }); return res.end(); } start = Math.max(0, size - suffix); end = size - 1; }
      else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) { res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...common, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` }); return fs.createReadStream(file, { start, end }).pipe(res);
    }
    if (req.method === 'GET' && srtRoute) {
      const session = await requireUser(req, res); if (!session) return;
      const job = await getOwnedJob(session.user.id, srtRoute[1]); if (!job) return send(res, 404, { error: 'Transcrição não encontrada.' });
      const dir = path.join(dataDir, srtRoute[1]);
      if (!fs.existsSync(path.join(dir, 'metadata.json'))) return send(res, 404, { error: 'Transcrição não encontrada' });
      const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
      if (!Array.isArray(metadata.transcriptionSegments) || !metadata.transcriptionSegments.length) return send(res, 409, { error: 'Esta transcrição ainda não tem marcações de tempo. Reprocesse o áudio para gerar o SRT.' });
      const wrap = text => { const lines = []; while (text.length > 42) { let split = text.lastIndexOf(' ', 42); if (split < 1) split = 42; lines.push(text.slice(0, split).trim()); text = text.slice(split).trim(); } if (text) lines.push(text); return lines.join('\r\n'); };
      const cues = buildCaptionCues(metadata.transcriptionSegments);
      const body = cues.map((cue, i) => `${i + 1}\r\n${captionTime(cue.start, ',')} --> ${captionTime(cue.end, ',')}\r\n${wrap(cue.text)}\r\n`).join('\r\n');
      const filename = `${path.parse(metadata.name || 'vozia').name.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'vozia'}.srt`;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="transcricao.srt"; filename*=UTF-8''${encodeURIComponent(filename)}` }); return res.end(`\uFEFF${body}`, 'utf8');
    }
    const vttRoute = url.pathname.match(/^\/api\/transcriptions\/([\da-f-]+)\.vtt$/i);
    if (req.method === 'GET' && vttRoute) {
      const session = await requireUser(req, res); if (!session) return;
      const job = await getOwnedJob(session.user.id, vttRoute[1]); if (!job) return send(res, 404, { error: 'Transcrição não encontrada.' });
      const dir = path.join(dataDir, vttRoute[1]);
      if (!fs.existsSync(path.join(dir, 'metadata.json'))) return send(res, 404, { error: 'Transcrição não encontrada' });
      const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
      if (!Array.isArray(metadata.transcriptionSegments) || !metadata.transcriptionSegments.length) return send(res, 409, { error: 'Esta transcrição ainda não tem legendas sincronizadas.' });
      const cues = buildCaptionCues(metadata.transcriptionSegments);
      const escapeCue = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const body = `WEBVTT\n\n${cues.map((cue, i) => `${i + 1}\n${captionTime(cue.start, '.')} --> ${captionTime(cue.end, '.')}\n${escapeCue(cue.text)}\n`).join('\n')}`;
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Content-Disposition': 'inline; filename="legendas.vtt"', 'X-Content-Type-Options': 'nosniff' }); return res.end(body, 'utf8');
    }
    if (req.method === 'GET' && statusRoute) {
      const session = await requireUser(req, res); if (!session) return;
      const row = await getOwnedJob(session.user.id, statusRoute[1]); if (!row) return send(res, 404, { error: 'Transcrição não encontrada' });
      const job = rowToJob(row);
      return send(res, 200, { ...job, transcript: row.transcript || null, segments: Array.isArray(row.segments) ? row.segments : [], language: row.detected_language || null, mediaType: row.media_type || '', hasMedia: job.hasAudio, error: row.error || null });
    }
    const authPages = { '/login': 'login', '/register': 'register', '/forgot-password': 'forgot-password', '/reset-password': 'reset-password' };
    const pageAliases = { '/': 'landing.html', '/index.html': 'index.html', '/app': 'index.html', '/workspace': 'index.html', '/transcriptions': 'index.html', '/plans': 'index.html', '/pricing': 'index.html', '/profile': 'index.html', '/me': 'index.html', '/help': 'index.html', '/admin': 'admin.html', '/dashboard': 'index.html' };
    const protectedPages = new Set(['/index.html', '/app', '/workspace', '/transcriptions', '/plans', '/pricing', '/profile', '/me', '/help', '/dashboard']);
    const staticFiles = ['/styles.css', '/transcript.css', '/landing.css', '/theme.css', '/pages.css', '/auth.css', '/app.js', '/landing.js', '/pages.js', '/auth.js', '/landing.html', '/admin.css', '/admin.js', '/vozia-icon.svg'];
    if (req.method === 'GET' && url.pathname === '/dashboard') { res.writeHead(302, { Location: `/app${url.search}`, 'Cache-Control': 'no-store' }); return res.end(); }
    if (req.method === 'GET' && Object.hasOwn(authPages, url.pathname)) {
      const session = supabase.configured() ? await supabase.authenticate(req, res) : null;
      if (session?.user && ['login', 'register'].includes(authPages[url.pathname])) { res.writeHead(302, { Location: '/app', 'Cache-Control': 'no-store' }); return res.end(); }
      const authFile = path.join(root, 'auth.html');
      const html = fs.readFileSync(authFile, 'utf8').replace('__AUTH_PAGE__', authPages[url.pathname]);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(html);
    }
    if (req.method === 'GET' && protectedPages.has(url.pathname)) {
      const session = supabase.configured() ? await supabase.authenticate(req, res) : null;
      if (!session?.user) { res.writeHead(302, { Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}`, 'Cache-Control': 'no-store' }); return res.end(); }
    }
    if (req.method === 'GET' && (Object.hasOwn(pageAliases, url.pathname) || staticFiles.includes(url.pathname))) {
      const requested = pageAliases[url.pathname] || url.pathname.slice(1);
      const file = path.join(root, requested);
      if (!fs.existsSync(file)) return send(res, 404, { error: 'Página ou recurso não encontrado.' });
      const type = file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': file.endsWith('.html') ? 'no-store' : 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }); return fs.createReadStream(file).pipe(res);
    }
    return send(res, 404, { error: 'Rota não encontrada' });
  } catch (error) { if (!res.headersSent) send(res, 500, { error: error.message }); else res.destroy(error); }
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Vozia disponível em http://${host}:${port}`));
resumeInterruptedJobs().catch(error => console.error('Falha ao retomar transcrições pendentes:', error.message));
