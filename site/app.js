(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const status = { uploading: 'Enviando', queued: 'Na fila', loading_model: 'Carregando modelo', transcribing: 'Transcrevendo', completed: 'Concluída', failed: 'Falhou' };
  let activeJobId = new URLSearchParams(location.search).get('job');
  let currentSession = null;
  const detailPanel = document.querySelector('#transcriptPanel');

  function renderJobs(jobs) {
    document.querySelector('#transcriptionCount').textContent = `${jobs.length} ${jobs.length === 1 ? 'arquivo' : 'arquivos'}`;
    const list = document.querySelector('#jobList');
    if (!jobs.length) { list.innerHTML = '<div class="empty">Você ainda não tem transcrições salvas.</div>'; return; }
    list.innerHTML = `<table class="jobs"><thead><tr><th>Arquivo</th><th>Status</th><th>Idioma</th><th>Data</th></tr></thead><tbody>${jobs.map(job => `<tr><td><a class="job-open" href="/app?job=${encodeURIComponent(job.id)}"><strong>${esc(job.name)}</strong></a><br><span class="muted">${esc(job.project)}</span></td><td class="status">${esc(status[job.status] || job.status)}</td><td>${esc(job.detected_language || job.language || '—')}</td><td>${date(job.created_at)}</td></tr>`).join('')}</tbody></table>`;
  }

  async function loadTranscript() {
    if (!activeJobId || !currentSession) return;
    detailPanel.hidden = false;
    try {
      currentSession = await VoziaAuth.validSession();
      if (!currentSession) throw new Error('Sua sessão expirou. Entre novamente.');
      const response = await fetch(`/api/transcriptions/${encodeURIComponent(activeJobId)}`, { headers: { Authorization: `Bearer ${currentSession.access_token}` } });
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || 'Não foi possível abrir esta transcrição.');
      document.querySelector('#transcriptTitle').textContent = job.name || 'Transcrição';
      document.querySelector('#transcriptStatus').textContent = status[job.status] || job.status;
      document.querySelector('#transcriptError').hidden = job.status !== 'failed';
      document.querySelector('#transcriptError').textContent = job.error || 'A transcrição falhou.';
      document.querySelector('#transcriptText').textContent = job.transcript || (job.status === 'completed' ? 'A transcrição foi concluída sem texto retornado.' : 'O áudio está sendo processado. Esta tela será atualizada automaticamente.');
      document.querySelector('#downloadSrt').hidden = job.status !== 'completed';
      return job.status;
    } catch (error) {
      document.querySelector('#transcriptStatus').textContent = error.message;
      return 'failed';
    }
  }
  async function start() {
    const session = await VoziaAuth.validSession();
    if (!session) { location.replace('/login?next=%2Fapp'); return; }
    currentSession = session;
    const user = await VoziaAuth.getUser();
    const profile = await VoziaAuth.getProfile(user.id);
    document.querySelector('#displayName').textContent = profile?.display_name || user.user_metadata?.full_name || user.email.split('@')[0];
    document.querySelector('#userEmail').textContent = user.email;
    document.querySelector('#adminLink').hidden = profile?.role !== 'admin';
    const jobs = await VoziaAuth.rest(`transcriptions?select=id,name,project,status,created_at,language,detected_language,size_bytes&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`);
    renderJobs(jobs);
    const downloadButton = document.querySelector('#downloadSrt');
    downloadButton.addEventListener('click', async () => {
      try {
        const response = await fetch(`/api/transcriptions/${encodeURIComponent(activeJobId)}.srt`, { headers: { Authorization: `Bearer ${currentSession.access_token}` } });
        if (!response.ok) throw new Error((await response.json()).error || 'Falha ao baixar o SRT.');
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${(document.querySelector('#transcriptTitle').textContent || 'vozia').replace(/[^\p{L}\p{N}._ -]/gu, '')}.srt`;
        link.click();
        URL.revokeObjectURL(link.href);
      } catch (error) { document.querySelector('#transcriptStatus').textContent = error.message; }
    }, { once: true });
    if (activeJobId) {
      const initialStatus = await loadTranscript();
      if (['queued', 'loading_model', 'transcribing', 'uploading'].includes(initialStatus)) {
        const poll = setInterval(async () => {
          const nextStatus = await loadTranscript();
          try {
            const user = await VoziaAuth.getUser();
            const updated = await VoziaAuth.rest(`transcriptions?select=id,name,project,status,created_at,language,detected_language,size_bytes&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`);
            renderJobs(updated);
          } catch {}
          if (!['queued', 'loading_model', 'transcribing', 'uploading'].includes(nextStatus)) clearInterval(poll);
        }, 5000);
        window.addEventListener('pagehide', () => clearInterval(poll), { once: true });
      }
    }
  }
  document.querySelector('#signOut').addEventListener('click', async () => { await VoziaAuth.signOut(); location.replace('/login'); });
  start().catch(error => {
    if (/migra|column|schema cache/i.test(error.message)) error.message = 'O banco ainda precisa da migração de contas Vozia.';
    document.querySelector('#jobList').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  });
})();
