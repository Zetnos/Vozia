(() => {
  const $ = selector => document.querySelector(selector);
  const loginView = $('#loginView');
  const adminView = $('#adminView');
  const loginMessage = $('#loginMessage');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  function showLogin(message = '') {
    loginView.hidden = false;
    adminView.hidden = true;
    loginMessage.hidden = !message;
    loginMessage.textContent = message;
  }
  function showAdmin(user) {
    loginView.hidden = true;
    adminView.hidden = false;
    $('#adminEmail').textContent = user.email;
  }
  function errorText(error) {
    if (error.status === 404 || /column|schema cache|role/i.test(error.message)) return 'A migração de permissões administrativas ainda não foi aplicada no Supabase.';
    return error.message || 'Não foi possível acessar os dados administrativos.';
  }
  async function load() {
    const user = await VoziaAuth.getUser();
    if (!user) { showLogin(); return; }
    const profile = await VoziaAuth.getProfile(user.id);
    if (profile?.role !== 'admin') { showLogin('Esta conta não tem acesso administrativo.'); return; }
    showAdmin(user);
    const [users, jobs] = await Promise.all([
      VoziaAuth.rest('profiles?select=id,display_name,role,created_at&order=created_at.desc&limit=100'),
      VoziaAuth.rest('transcriptions?select=id,user_id,name,status,language,created_at&order=created_at.desc&limit=100')
    ]);
    $('#userCount').textContent = users.length;
    $('#jobCount').textContent = jobs.length;
    $('#doneCount').textContent = jobs.filter(job => job.status === 'completed').length;
    $('#usersTable').innerHTML = users.length
      ? `<table class="rows"><thead><tr><th>Nome</th><th>Permissão</th><th>Criada em</th></tr></thead><tbody>${users.map(profile => `<tr><td>${esc(profile.display_name || 'Sem nome')}</td><td class="pill">${profile.role === 'admin' ? 'Admin' : 'Usuário'}</td><td>${date(profile.created_at)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Ainda não há contas.</div>';
    $('#jobsTable').innerHTML = jobs.length
      ? `<table class="rows"><thead><tr><th>Arquivo</th><th>Status</th><th>Idioma</th><th>Criada em</th></tr></thead><tbody>${jobs.map(job => `<tr><td>${esc(job.name)}</td><td class="pill">${esc(job.status)}</td><td>${esc(job.language || 'Automático')}</td><td>${date(job.created_at)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Ainda não há transcrições.</div>';
  }
  $('#adminLogin').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const values = new FormData(event.currentTarget);
      await VoziaAuth.signIn({ email: String(values.get('email')).trim(), password: String(values.get('password')) });
      await load();
    } catch (error) { showLogin(errorText(error)); }
    finally { button.disabled = false; }
  });
  $('#signOut').addEventListener('click', async () => { await VoziaAuth.signOut(); showLogin('Você saiu do painel administrativo.'); });
  load().catch(error => showLogin(errorText(error)));
})();
