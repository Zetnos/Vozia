(() => {
  const path = location.pathname;
  const view = document.querySelector('#routeView');
  const appContent = document.querySelector('.content');
  const title = document.querySelector('#routeTitle');
  let currentProfile = {};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const size = value => value > 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
  const date = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value)) : '—';
  const status = { completed: 'Concluída', failed: 'Com erro', queued: 'Na fila', loading_model: 'Preparando', transcribing: 'Transcrevendo', uploading: 'Enviando' };
  async function accountData() {
    const response = await fetch('/api/me');
    if (!response.ok) throw new Error('Sua sessão expirou. Entre novamente.');
    const account = await response.json(); currentProfile = account.profile || {};
    const name = currentProfile.display_name || account.user?.user_metadata?.full_name || '';
    document.querySelector('#sidebarName').textContent = name || 'Meu perfil';
    document.querySelector('#sidebarAvatar').textContent = [...(name || 'V')][0].toLocaleUpperCase('pt-BR');
    return account;
  }

  async function dashboard() {
    const account = await accountData();
    const name = (currentProfile.display_name || account.user?.user_metadata?.full_name || '').trim();
    if (name) {
      document.querySelector('#sidebarName').textContent = name;
      document.querySelector('#sidebarAvatar').textContent = [...name][0]?.toLocaleUpperCase('pt-BR') || 'V';
      document.querySelector('#dashboardGreeting').textContent = `Olá, ${name}`;
    }
    try {
      const data = await fetch('/api/workspace/jobs').then(response => {
        if (!response.ok) throw new Error('Não foi possível carregar seu espaço.');
        return response.json();
      });
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      const completed = jobs.filter(job => job.status === 'completed').length;
      const processing = jobs.filter(job => ['queued', 'loading_model', 'transcribing', 'uploading'].includes(job.status)).length;
      document.querySelector('#dashboardTotal').textContent = data.total ?? jobs.length;
      document.querySelector('#dashboardCompleted').textContent = completed;
      document.querySelector('#dashboardProcessing').textContent = processing;
      document.querySelector('#dashboardStorage').textContent = size(data.storageBytes || 0);
      const recent = document.querySelector('#dashboardRecent');
      const latest = jobs.slice(0, 4);
      recent.innerHTML = latest.length ? latest.map(job => `<a class="dashboard-job" href="${job.status === 'completed' ? `/app?job=${encodeURIComponent(job.id)}` : '/workspace'}"><span class="dashboard-job-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h2l2-5 4 10 2-5h4"/></svg></span><span class="dashboard-job-main"><b title="${esc(job.name)}">${esc(job.name)}</b><small>${esc(job.project || 'Transcrição')} · ${date(job.createdAt)}</small></span><span class="dashboard-job-status ${esc(job.status)}">${esc(status[job.status] || job.status)}</span><svg class="dashboard-job-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></a>`).join('') : '<div class="recent-empty"><span class="empty-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><b>Suas gravações aparecem aqui</b><p>Quando enviar um arquivo, você poderá acompanhar seu status e abrir a transcrição por aqui.</p></div>';
      renderActivity(jobs);
    } catch {
      document.querySelector('#dashboardRecent').innerHTML = '<div class="recent-empty"><b>Não foi possível carregar suas gravações</b><p>Confira a conexão com o servidor Vozia e tente novamente.</p></div>';
      document.querySelector('#chartEmpty').textContent = 'Não foi possível carregar a atividade recente.';
    }
    fetch('/api/health').then(response => response.json()).then(health => {
      const badge = document.querySelector('#engineStatus');
      const model = document.querySelector('#dashboardModel');
      if (health.whisperInstalled === false) { badge.classList.add('engine-offline'); badge.innerHTML = '<i></i> NÃO INSTALADO'; }
      if (health.model && model) model.textContent = `Whisper ${health.model}`;
    }).catch(() => {
      const badge = document.querySelector('#engineStatus');
      badge.classList.add('engine-offline'); badge.innerHTML = '<i></i> OFFLINE';
    });
  }

  function renderActivity(jobs) {
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - index));
      return day;
    });
    const counts = days.map(day => jobs.filter(job => {
      const created = new Date(job.createdAt); created.setHours(0, 0, 0, 0);
      return created.getTime() === day.getTime();
    }).length);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const maximum = Math.max(1, ...counts);
    const points = counts.map((count, index) => ({ x: 8 + index * (704 / 6), y: 166 - (count / maximum) * 132 }));
    const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
    document.querySelector('#chartLine').setAttribute('d', total ? line : '');
    document.querySelector('#chartArea').setAttribute('d', total ? `${line} L712 174 L8 174 Z` : '');
    document.querySelector('#chartPoints').innerHTML = total ? points.map(point => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5" class="chart-point"/>`).join('') : '';
    const scale = total ? [maximum, Math.ceil(maximum * .75), Math.ceil(maximum * .5), Math.ceil(maximum * .25), 0] : [0, 0, 0, 0, 0];
    document.querySelector('#chartYLabels').innerHTML = scale.map(value => `<span>${value}</span>`).join('');
    document.querySelector('#chartXLabels').innerHTML = days.map(day => `<span>${new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(day).replace('.', '')}</span>`).join('');
    document.querySelector('#chartEmpty').hidden = total > 0;
    document.querySelector('#chartPeriod').textContent = `${total} ${total === 1 ? 'arquivo recebido' : 'arquivos recebidos'} nos últimos 7 dias`;
  }

  if (path === '/app' || path === '/index.html' || path === '/') {
    if (document.querySelector('#dashboardGreeting')) dashboard();
    return;
  }

  appContent.hidden = true;
  view.hidden = false;
  document.querySelectorAll('.nav-item').forEach(link => link.classList.toggle('active', (path === '/app' && link.pathname === '/app') || (['/workspace', '/transcriptions'].includes(path) && link.pathname === '/workspace' && new URL(location.href).searchParams.get('filter') !== 'favorites') || (path === '/workspace' && new URL(location.href).searchParams.get('filter') === 'favorites' && new URL(link.href).searchParams.get('filter') === 'favorites')));
  const shell = (heading, description, body) => {
    title.textContent = heading;
    view.innerHTML = `<div class="route-inner"><h1>${esc(heading)}</h1><p class="route-lead">${esc(description)}</p>${body}</div>`;
  };

  async function workspace() {
    await accountData();
    const isFavorites = new URL(location.href).searchParams.get('filter') === 'favorites';
    shell(isFavorites ? 'Favoritos' : 'Meu espaço', isFavorites ? 'Suas transcrições salvas para encontrar com facilidade.' : 'Acompanhe seus arquivos, resultados e espaço de trabalho.', '<div class="route-stats" id="workspaceStats"></div><div class="route-toolbar"><div><h2>Transcrições recentes</h2><p>Seus arquivos e resultados associados à sua conta.</p></div><a class="route-button" href="/app">＋ Nova transcrição</a></div><div class="job-list" id="jobList"><div class="route-empty">Carregando seus arquivos…</div></div>');
    const data = await fetch('/api/workspace/jobs').then(response => { if (!response.ok) throw new Error('Não foi possível carregar seu espaço.'); return response.json(); });
    const saved = new Set(data.jobs.filter(job => job.favorite).map(job => job.id));
    const jobs = isFavorites ? data.jobs.filter(job => job.favorite) : data.jobs;
    document.querySelector('#workspaceStats').innerHTML = `<article><small>ARQUIVOS</small><b>${data.total}</b></article><article><small>CONCLUÍDOS</small><b>${data.jobs.filter(job => job.status === 'completed').length}</b></article><article><small>ARMAZENAMENTO</small><b>${size(data.storageBytes)}</b></article>`;
    const list = document.querySelector('#jobList');
    if (!jobs.length) {
      list.innerHTML = `<div class="route-empty"><span class="route-empty-icon">${isFavorites ? '☆' : '♫'}</span><h2>${isFavorites ? 'Ainda não há favoritos' : 'Seu espaço está pronto'}</h2><p>${isFavorites ? 'Marque uma transcrição com a estrela para encontrá-la aqui.' : 'Envie seu primeiro arquivo para ver o andamento e acessar a transcrição neste painel.'}</p><a class="route-button" href="/app">Começar uma transcrição <span>→</span></a></div>`;
      return;
    }
    list.innerHTML = jobs.map(job => `<article class="job-row"><span class="job-file-icon">♫</span><div class="job-primary"><b title="${esc(job.name)}">${esc(job.name)}</b><small>${esc(job.project)} · ${date(job.createdAt)} · ${size(job.size)}</small></div><span class="job-state ${esc(job.status)}">${esc(status[job.status] || job.status)}</span><button class="favorite-toggle ${saved.has(job.id) ? 'is-favorite' : ''}" type="button" data-favorite="${esc(job.id)}" aria-label="${saved.has(job.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">★</button>${job.status === 'completed' ? `<a class="job-open" href="/app?job=${encodeURIComponent(job.id)}">Abrir transcrição →</a>` : '<span class="job-open disabled">Disponível após concluir</span>'}</article>`).join('');
    list.querySelectorAll('[data-favorite]').forEach(button => button.addEventListener('click', async () => {
      const job = data.jobs.find(item => item.id === button.dataset.favorite);
      if (!job) return;
      await fetch(`/api/transcriptions/${encodeURIComponent(job.id)}/favorite`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: !job.favorite }) });
      workspace();
    }));
  }

  function plans() {
    shell('Planos', 'Conheça o acesso disponível na Vozia e as opções em preparação.', '<div class="plan-grid"><article class="route-plan current-plan"><span class="route-plan-tag">DISPONÍVEL AGORA</span><h2>Vozia</h2><p class="route-price">Acesso gratuito</p><p class="route-plan-copy">Transcreva com Whisper processado no servidor Vozia e mantenha seu histórico vinculado à conta.</p><ul><li>Conta pessoal com login seguro</li><li>Upload de áudio e vídeo em partes</li><li>Arquivos grandes dentro da capacidade do servidor</li><li>Player sincronizado e exportação SRT</li></ul><a class="route-button" href="/app">Abrir meu espaço <span>→</span></a></article><article class="route-plan future-plan"><span class="route-plan-tag">EM PLANEJAMENTO</span><h2>Vozia Pro</h2><p class="route-price">Em breve</p><p class="route-plan-copy">Estamos preparando recursos para equipes e fluxos de trabalho maiores.</p><ul><li>Espaços compartilhados</li><li>Organização avançada</li><li>Mais opções de exportação</li><li>Controle de acesso para equipes</li></ul><a class="route-text-link" href="/help#planos">Acompanhar novidades <span>↗</span></a></article></div><p class="route-footnote">Os preços e limites comerciais ainda não estão configurados nesta versão.</p>');
  }

  async function profilePage() {
    const account = await accountData(); const name = currentProfile.display_name || account.user?.user_metadata?.full_name || '';
    shell('Perfil', 'Edite as informações vinculadas à sua conta Vozia.', `<form class="profile-form" id="profileForm"><div class="profile-identity"><span class="profile-avatar">${esc([...(name || 'V')][0].toLocaleUpperCase('pt-BR'))}</span><div><b>${esc(name || 'Seu perfil')}</b><small>${esc(account.user?.email || '')}</small></div></div><label>Nome de exibição<input name="name" maxlength="80" value="${esc(name)}" placeholder="Como devemos chamar você?" required></label><label>E-mail<input type="email" value="${esc(account.user?.email || '')}" readonly></label><div class="profile-note">O perfil e as transcrições ficam associados à sua conta Supabase.</div><button class="route-button" type="submit">Salvar perfil <span>→</span></button><button class="route-button route-signout" id="signOut" type="button">Sair da conta</button><p class="profile-saved" id="profileSaved" role="status" hidden>Perfil atualizado.</p><p class="profile-error" id="profileError" role="alert" hidden></p></form>`);
    document.querySelector('#profileForm').addEventListener('submit', async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const displayName = String(form.get('name') || '').trim();
      const response = await fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
      if (!response.ok) { document.querySelector('#profileError').textContent = (await response.json()).error || 'Não foi possível salvar.'; document.querySelector('#profileError').hidden = false; return; }
      currentProfile.display_name = displayName;
      document.querySelector('#sidebarName').textContent = displayName;
      document.querySelector('#sidebarAvatar').textContent = [...displayName][0]?.toLocaleUpperCase('pt-BR') || 'V';
      document.querySelector('.profile-avatar').textContent = [...displayName][0]?.toLocaleUpperCase('pt-BR') || 'V';
      document.querySelector('.profile-identity b').textContent = displayName;
      document.querySelector('#profileSaved').hidden = false;
    });
    document.querySelector('#signOut').addEventListener('click', async () => {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (response.ok) location.assign('/');
    });
  }

  function help() {
    shell('Ajuda', 'Respostas rápidas para usar o espaço de transcrição.', '<div class="help-list"><details open><summary>Como começo uma transcrição?</summary><p>Abra “Nova transcrição”, selecione um arquivo de áudio ou vídeo, escolha o idioma e inicie o envio.</p></details><details><summary>Posso enviar arquivos acima de 100 MB?</summary><p>Sim. O aplicativo divide arquivos grandes em partes durante o envio. O processamento é feito pelo Whisper instalado no servidor Vozia.</p></details><details><summary>Como exporto legendas?</summary><p>Depois de concluir, use “Baixar .SRT” no painel da transcrição. Em vídeos, o botão CC controla as legendas exibidas no player.</p></details><details id="planos"><summary>Quais planos estão disponíveis?</summary><p>O acesso gratuito está disponível. Os recursos Vozia Pro ainda estão em planejamento e não podem ser contratados nesta versão.</p></details><div class="help-contact"><b>Precisa de mais ajuda?</b><p>Consulte o painel Vozia ou volte para iniciar uma nova transcrição.</p><a class="route-button" href="/app">Abrir o aplicativo <span>→</span></a></div></div>');
  }

  if (path === '/workspace' || path === '/transcriptions') workspace().catch(error => { view.innerHTML += `<p class="route-error">${esc(error.message)}</p>`; });
  else if (path === '/plans' || path === '/pricing') plans();
  else if (path === '/profile' || path === '/me') profilePage().catch(error => { view.innerHTML += `<p class="route-error">${esc(error.message)}</p>`; });
  else if (path === '/help') help();
  else location.replace('/app');
})();
