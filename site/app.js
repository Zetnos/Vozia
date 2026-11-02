(() => {
  const $ = selector => document.querySelector(selector);
  const svgNS = 'http://www.w3.org/2000/svg';
  const pendingStatuses = new Set(['uploading', 'queued', 'loading_model', 'transcribing']);
  const statusLabels = { uploading: 'Enviando', queued: 'Na fila', loading_model: 'Carregando modelo', transcribing: 'Transcrevendo', completed: 'Concluída', failed: 'Falhou' };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const formatDate = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const formatSize = bytes => !Number(bytes) ? '—' : Number(bytes) >= 1024 ** 3 ? `${(Number(bytes) / 1024 ** 3).toFixed(1)} GB` : `${(Number(bytes) / 1024 ** 2).toFixed(1)} MB`;
  const showToast = message => {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
  };

  let session = null;
  let jobs = [];
  let user = null;
  let activeJobId = new URLSearchParams(location.search).get('job');
  let selectedFile = null;
  let pollingTimer = null;
  const uploadForm = $('#uploadForm');
  const uploadInput = $('#uploadFile');
  const uploadDrop = $('#fileDrop');
  const uploadStatus = $('#uploadStatus');
  const uploadButton = $('#submitUpload');

  async function authorizedFetch(url, options = {}) {
    session = await VoziaAuth.validSession();
    if (!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente.');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${session.access_token}`);
    return fetch(url, { ...options, headers });
  }

  function initials(name, email) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : (parts[0] || email || 'V').slice(0, 2)).toUpperCase();
  }

  function updateSummary() {
    const done = jobs.filter(job => job.status === 'completed').length;
    const pending = jobs.filter(job => pendingStatuses.has(job.status)).length;
    const languages = new Set(jobs.map(job => String(job.detected_language || job.language || '').trim()).filter(language => language && language.toLowerCase() !== 'auto'));
    $('#metricTotal').textContent = jobs.length.toLocaleString('pt-BR');
    $('#metricDone').textContent = done.toLocaleString('pt-BR');
    $('#metricProcessing').textContent = pending.toLocaleString('pt-BR');
    $('#metricLanguages').textContent = languages.size.toLocaleString('pt-BR');
    $('#notificationDot').hidden = pending === 0;
    drawChart(Number($('#period').value) || 7);
  }

  function drawChart(days) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);
    const bucketCount = days === 7 ? 7 : days === 30 ? 10 : 13;
    const bucketSpan = days / bucketCount;
    const counts = Array(bucketCount).fill(0);
    const labels = Array.from({ length: bucketCount }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + Math.floor(index * bucketSpan));
      return days === 7 ? date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
    });
    jobs.forEach(job => {
      const date = new Date(job.created_at);
      if (!Number.isFinite(date.getTime()) || date < start || date > now) return;
      const index = Math.min(bucketCount - 1, Math.floor((date - start) / (1000 * 60 * 60 * 24 * bucketSpan)));
      counts[index]++;
    });
    const grid = $('#grid');
    const labelGroup = $('#labels');
    const points = $('#points');
    grid.replaceChildren(); labelGroup.replaceChildren(); points.replaceChildren();
    const x0 = 44, x1 = 648, y0 = 18, y1 = 202, max = Math.max(4, ...counts);
    for (let i = 0; i < 5; i++) {
      const y = y1 - (y1 - y0) * i / 4;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', x0); line.setAttribute('x2', x1); line.setAttribute('y1', y); line.setAttribute('y2', y); line.setAttribute('class', 'gridline'); grid.appendChild(line);
      const tick = document.createElementNS(svgNS, 'text');
      tick.setAttribute('x', x0 - 9); tick.setAttribute('y', y + 3); tick.setAttribute('text-anchor', 'end'); tick.setAttribute('class', 'axis-text'); tick.textContent = String(Math.round(max * i / 4)); labelGroup.appendChild(tick);
    }
    const coordinates = counts.map((count, index) => [x0 + index * (x1 - x0) / (bucketCount - 1), y1 - count / max * (y1 - y0)]);
    const path = coordinates.map((point, index) => `${index ? 'L' : 'M'} ${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ');
    $('#chartLine').setAttribute('d', path);
    $('#chartArea').setAttribute('d', `${path} L ${x1} ${y1} L ${x0} ${y1} Z`);
    coordinates.forEach((point, index) => {
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', point[0]); circle.setAttribute('cy', point[1]); circle.setAttribute('r', counts[index] ? 4 : 2); circle.setAttribute('class', 'chart-point'); points.appendChild(circle);
      if (bucketCount <= 10 || index % 2 === 0 || index === bucketCount - 1) {
        const text = document.createElementNS(svgNS, 'text');
        text.setAttribute('x', point[0]); text.setAttribute('y', '229'); text.setAttribute('text-anchor', 'middle'); text.setAttribute('class', 'axis-text'); text.textContent = labels[index]; labelGroup.appendChild(text);
      }
    });
    $('#chartCaption').textContent = `Arquivos enviados nos últimos ${days} dias`;
  }

  function makeDecorativeWave(seed = 'vozia') {
    const wave = $('#recentWave');
    wave.replaceChildren();
    if (!seed) { wave.hidden = true; return; }
    wave.hidden = false;
    const code = [...String(seed)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    for (let i = 0; i < 54; i++) {
      const bar = document.createElement('i');
      const height = 10 + Math.abs(Math.sin((i + code % 13) * .49) * 65) + Math.abs(Math.cos((i + code % 19) * .19) * 18);
      bar.className = 'bar';
      bar.style.setProperty('--h', `${Math.min(height, 98)}%`);
      bar.style.setProperty('--i', i);
      wave.appendChild(bar);
    }
  }

  function renderRecent() {
    const job = jobs[0];
    const link = $('#viewTranscript');
    if (!job) {
      $('#recentSubtitle').textContent = 'Sua biblioteca está pronta para começar';
      $('#recentState').textContent = '';
      $('#recentState').removeAttribute('data-status');
      $('#recentName').textContent = 'Nenhuma transcrição ainda';
      $('#recentMeta').textContent = 'Envie seu primeiro áudio ou vídeo.';
      $('#recentSize').textContent = '';
      $('#recentLanguage').textContent = '';
      link.textContent = 'Enviar primeiro arquivo →';
      link.href = '#uploadPanel';
      makeDecorativeWave('');
      return;
    }
    const status = statusLabels[job.status] || job.status;
    $('#recentSubtitle').textContent = formatDate(job.created_at);
    $('#recentState').textContent = status;
    $('#recentState').dataset.status = job.status || '';
    $('#recentName').textContent = job.name || 'Arquivo de áudio';
    $('#recentMeta').textContent = `${job.project || 'Nova transcrição'} · ${formatDate(job.created_at)}`;
    $('#recentSize').textContent = formatSize(job.size_bytes);
    $('#recentLanguage').innerHTML = `<b></b>${escapeHtml(job.detected_language || job.language || 'Idioma automático')}`;
    link.textContent = job.status === 'completed' ? 'Abrir transcrição ↗' : 'Acompanhar arquivo ↗';
    link.href = `/app?job=${encodeURIComponent(job.id)}#transcriptPanel`;
    makeDecorativeWave(job.id || job.name);
  }

  function renderJobs() {
    $('#transcriptionCount').textContent = `${jobs.length} ${jobs.length === 1 ? 'arquivo' : 'arquivos'}`;
    const list = $('#jobList');
    if (!jobs.length) {
      list.innerHTML = '<div class="empty">Você ainda não tem arquivos. Envie seu primeiro áudio para começar.</div>';
      return;
    }
    list.innerHTML = `<table class="jobs"><thead><tr><th>Arquivo</th><th>Status</th><th>Idioma</th><th>Enviado</th></tr></thead><tbody>${jobs.slice(0, 8).map(job => `<tr><td><a href="/app?job=${encodeURIComponent(job.id)}#transcriptPanel">${escapeHtml(job.name || 'Arquivo de áudio')}</a><small>${escapeHtml(job.project || 'Nova transcrição')} · ${formatSize(job.size_bytes)}</small></td><td><span class="status-chip" data-status="${escapeHtml(job.status)}">${escapeHtml(statusLabels[job.status] || job.status || '—')}</span></td><td>${escapeHtml(job.detected_language || job.language || '—')}</td><td>${escapeHtml(formatDate(job.created_at))}</td></tr>`).join('')}</tbody></table>`;
  }

  async function loadJobs() {
    const rows = await VoziaAuth.rest(`transcriptions?select=id,name,project,status,created_at,language,detected_language,size_bytes&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`);
    jobs = Array.isArray(rows) ? rows : [];
    renderJobs(); renderRecent(); updateSummary();
    return jobs;
  }

  async function loadTranscript() {
    if (!activeJobId) return '';
    const response = await authorizedFetch(`/api/transcriptions/${encodeURIComponent(activeJobId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível abrir esta transcrição.');
    $('#transcriptPanel').hidden = false;
    $('#transcriptTitle').textContent = data.name || 'Transcrição';
    $('#transcriptStatus').textContent = statusLabels[data.status] || data.status || 'Em processamento';
    $('#transcriptError').hidden = data.status !== 'failed';
    $('#transcriptError').textContent = data.error || 'A transcrição falhou.';
    $('#transcriptText').textContent = data.transcript || (data.status === 'completed' ? 'A transcrição foi concluída sem texto retornado.' : 'O arquivo está sendo processado. O painel será atualizado automaticamente.');
    $('#downloadSrt').hidden = data.status !== 'completed';
    return data.status;
  }

  async function refreshData() {
    await loadJobs();
    if (activeJobId) {
      try {
        const currentStatus = await loadTranscript();
        if (!pendingStatuses.has(currentStatus)) { clearInterval(pollingTimer); pollingTimer = null; }
      } catch (error) {
        $('#transcriptPanel').hidden = false;
        $('#transcriptStatus').textContent = error.message;
        clearInterval(pollingTimer); pollingTimer = null;
      }
    }
  }

  async function checkServer() {
    const badge = $('#healthIndicator');
    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      const ready = response.ok && data.server !== 'offline' && data.whisperInstalled !== false;
      badge.dataset.state = ready ? 'online' : 'offline';
      badge.innerHTML = `<i></i>${ready ? 'Disponível' : 'Indisponível'}`;
      $('#serverBadge').textContent = ready ? 'Online' : 'Offline';
      $('#serverStatus').textContent = ready ? 'Whisper pronto para receber arquivos' : data.error || 'Conecte o servidor local para transcrever';
      $('#serverMeter').style.width = ready ? '100%' : '12%';
      $('#integrationCopy').textContent = ready ? 'O servidor Vozia respondeu e está pronto para processar seus arquivos.' : data.error || 'Não foi possível alcançar o servidor de transcrição. Inicie ou conecte o servidor Whisper.';
    } catch {
      badge.dataset.state = 'offline';
      badge.innerHTML = '<i></i>Indisponível';
      $('#serverBadge').textContent = 'Offline';
      $('#serverStatus').textContent = 'Servidor de transcrição não conectado';
      $('#serverMeter').style.width = '12%';
      $('#integrationCopy').textContent = 'Não foi possível alcançar o servidor de transcrição. Confira a implantação da API Vozia.';
    }
  }

  function setUploadStatus(message, kind = '') {
    uploadStatus.textContent = message;
    uploadStatus.dataset.state = kind;
  }

  function chooseFile(file) {
    if (!file) return;
    const accepted = /\.(mp3|wav|m4a|mp4|aac|ogg|flac|webm)$/i.test(file.name) || file.type.startsWith('audio/') || file.type.startsWith('video/');
    if (!accepted) { setUploadStatus('Esse formato não é compatível. Escolha áudio ou vídeo.', 'error'); return; }
    selectedFile = file;
    $('#dropTitle').textContent = file.name;
    $('#selectedName').textContent = file.name;
    $('#selectedMeta').textContent = `${formatSize(file.size)} · ${file.type || 'arquivo de mídia'}`;
    $('#selectedFile').hidden = false;
    $('#fileFormats').hidden = true;
    uploadButton.disabled = false;
    setUploadStatus(file.size > 100 * 1024 * 1024 ? 'Arquivo grande pronto · o envio será dividido em partes.' : 'Arquivo pronto para envio.');
  }

  function clearFile() {
    selectedFile = null;
    uploadInput.value = '';
    $('#dropTitle').textContent = 'Arraste seu arquivo até aqui';
    $('#selectedFile').hidden = true;
    $('#fileFormats').hidden = false;
    uploadButton.disabled = true;
    setUploadStatus('O envio é dividido em partes para suportar arquivos grandes.');
  }

  async function startUpload(event) {
    event.preventDefault();
    if (!selectedFile || uploadButton.disabled) return;
    uploadButton.disabled = true;
    uploadButton.textContent = 'Preparando envio…';
    $('#uploadProgress').hidden = false;
    setUploadStatus('Conectando ao servidor de transcrição…');
    try {
      const healthResponse = await fetch('/api/health');
      const health = await healthResponse.json().catch(() => ({}));
      if (!healthResponse.ok || health.server === 'offline' || health.whisperInstalled === false) throw new Error(health.error || 'O servidor Whisper está indisponível.');
      const startResponse = await authorizedFetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: selectedFile.name, size: selectedFile.size, type: selectedFile.type || 'application/octet-stream', language: $('#uploadLanguage').value, project: 'Nova transcrição' }) });
      const startData = await startResponse.json();
      if (!startResponse.ok) throw new Error(startData.error || 'Não foi possível iniciar o envio.');
      const total = Math.ceil(selectedFile.size / startData.chunkSize);
      for (let index = 0; index < total; index++) {
        const chunk = selectedFile.slice(index * startData.chunkSize, Math.min(selectedFile.size, (index + 1) * startData.chunkSize));
        const response = await authorizedFetch(`/api/uploads/${startData.id}/chunks/${index}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk });
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Falha ao enviar a parte ${index + 1} de ${total}.`); }
        const percent = Math.round((index + 1) / total * 100);
        $('#uploadProgressBar').style.width = `${percent}%`;
        setUploadStatus(`Enviando parte ${index + 1} de ${total} · ${percent}%`);
      }
      const complete = await authorizedFetch(`/api/uploads/${startData.id}/complete`, { method: 'POST' });
      const result = await complete.json();
      if (!complete.ok) throw new Error(result.error || 'Não foi possível finalizar o envio.');
      setUploadStatus('Arquivo recebido. Abrindo a transcrição…', 'success');
      location.assign(`/app?job=${encodeURIComponent(startData.id)}#transcriptPanel`);
    } catch (error) {
      setUploadStatus(error.message || 'Não foi possível enviar o arquivo. Tente novamente.', 'error');
      uploadButton.disabled = false;
      uploadButton.innerHTML = 'Tentar novamente <span aria-hidden="true">→</span>';
    }
  }

  async function start() {
    session = await VoziaAuth.validSession();
    if (!session) { location.replace('/login?next=%2Fapp'); return; }
    user = await VoziaAuth.getUser();
    if (!user?.id) { await VoziaAuth.signOut(); location.replace('/login?next=%2Fapp'); return; }
    const profile = await VoziaAuth.getProfile(user.id).catch(() => null);
    const displayName = profile?.display_name || user.user_metadata?.full_name || user.email.split('@')[0];
    const avatar = initials(displayName, user.email);
    $('#displayName').textContent = displayName;
    $('#userEmail').textContent = user.email;
    $('#userAvatar').textContent = avatar;
    $('#accountAvatar').textContent = avatar;
    $('#accountName').textContent = displayName;
    $('#accountEmail').textContent = user.email;
    $('#profileButton').textContent = avatar;
    $('#profileButton').title = displayName;
    $('#adminLink').hidden = profile?.role !== 'admin';
    await Promise.all([loadJobs(), checkServer()]);
    if (activeJobId) {
      const status = await loadTranscript().catch(error => { $('#transcriptPanel').hidden = false; $('#transcriptStatus').textContent = error.message; return 'failed'; });
      if (pendingStatuses.has(status)) pollingTimer = setInterval(refreshData, 5000);
      if (location.hash === '#transcriptPanel') $('#transcriptPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  $('#period').addEventListener('change', event => drawChart(Number(event.target.value) || 7));
  $('#newTrans').addEventListener('click', () => { $('#uploadPanel').scrollIntoView({ behavior: 'smooth', block: 'center' }); uploadInput.click(); });
  $('#profileButton').addEventListener('click', () => $('#account').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  $('#notifications').addEventListener('click', () => {
    const count = jobs.filter(job => pendingStatuses.has(job.status)).length;
    showToast(count ? `Você tem ${count} ${count === 1 ? 'arquivo em processamento' : 'arquivos em processamento'}.` : 'Nenhuma transcrição pendente.');
  });
  $('#menuButton').addEventListener('click', event => {
    const open = $('#sidebar').classList.toggle('mobile-open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.nav a[href^="#"]').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.nav a').forEach(item => item.classList.toggle('active', item === link));
    if (innerWidth <= 650) { $('#sidebar').classList.remove('mobile-open'); $('#menuButton').setAttribute('aria-expanded', 'false'); }
  }));
  $('#signOut').addEventListener('click', async () => { await VoziaAuth.signOut(); location.replace('/login'); });
  $('#chooseFile').addEventListener('click', () => uploadInput.click());
  uploadInput.addEventListener('change', () => chooseFile(uploadInput.files?.[0]));
  $('#clearFile').addEventListener('click', clearFile);
  uploadDrop.addEventListener('dragover', event => { event.preventDefault(); uploadDrop.classList.add('is-dragging'); });
  uploadDrop.addEventListener('dragleave', event => { if (!uploadDrop.contains(event.relatedTarget)) uploadDrop.classList.remove('is-dragging'); });
  uploadDrop.addEventListener('drop', event => { event.preventDefault(); uploadDrop.classList.remove('is-dragging'); chooseFile(event.dataTransfer?.files?.[0]); });
  uploadForm.addEventListener('submit', startUpload);
  $('#downloadSrt').addEventListener('click', async () => {
    try {
      const response = await authorizedFetch(`/api/transcriptions/${encodeURIComponent(activeJobId)}.srt`);
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Não foi possível baixar o SRT.'); }
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${($('#transcriptTitle').textContent || 'vozia').replace(/[^\p{L}\p{N}._ -]/gu, '')}.srt`;
      link.click(); URL.revokeObjectURL(link.href);
    } catch (error) { showToast(error.message); }
  });
  window.addEventListener('pagehide', () => clearInterval(pollingTimer));
  start().catch(error => {
    const message = /migra|column|schema cache/i.test(error.message) ? 'O banco ainda precisa da migração de contas Vozia.' : error.message;
    $('#jobList').innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  });
})();
