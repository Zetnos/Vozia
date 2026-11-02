(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const status = { uploading: 'Enviando', queued: 'Na fila', loading_model: 'Carregando modelo', transcribing: 'Transcrevendo', completed: 'Concluída', failed: 'Falhou' };
  async function start() {
    const session = await VoziaAuth.validSession();
    if (!session) { location.replace('/login?next=%2Fapp'); return; }
    const user = await VoziaAuth.getUser();
    const profile = await VoziaAuth.getProfile(user.id);
    document.querySelector('#displayName').textContent = profile?.display_name || user.user_metadata?.full_name || user.email.split('@')[0];
    document.querySelector('#userEmail').textContent = user.email;
    document.querySelector('#adminLink').hidden = profile?.role !== 'admin';
    const jobs = await VoziaAuth.rest(`transcriptions?select=id,name,project,status,created_at,language,detected_language,size_bytes&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`);
    document.querySelector('#transcriptionCount').textContent = `${jobs.length} ${jobs.length === 1 ? 'arquivo' : 'arquivos'}`;
    const list = document.querySelector('#jobList');
    if (!jobs.length) { list.innerHTML = '<div class="empty">Você ainda não tem transcrições salvas.</div>'; return; }
    list.innerHTML = `<table class="jobs"><thead><tr><th>Arquivo</th><th>Status</th><th>Idioma</th><th>Data</th></tr></thead><tbody>${jobs.map(job => `<tr><td><strong>${esc(job.name)}</strong><br><span class="muted">${esc(job.project)}</span></td><td class="status">${esc(status[job.status] || job.status)}</td><td>${esc(job.detected_language || job.language || '—')}</td><td>${date(job.created_at)}</td></tr>`).join('')}</tbody></table>`;
  }
  document.querySelector('#signOut').addEventListener('click', async () => { await VoziaAuth.signOut(); location.replace('/login'); });
  start().catch(error => {
    if (/migra|column|schema cache/i.test(error.message)) error.message = 'O banco ainda precisa da migração de contas Vozia.';
    document.querySelector('#jobList').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  });
})();
