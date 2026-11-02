(() => {
  const page = document.body.dataset.page || 'login';
  const form = document.querySelector('#authForm');
  const notice = document.querySelector('#authNotice');
  const submit = document.querySelector('#authSubmit');
  const title = document.querySelector('#authTitle');
  const description = document.querySelector('#authDescription');
  const nameField = document.querySelector('#nameField');
  const passwordField = document.querySelector('#passwordField');
  const confirmField = document.querySelector('#confirmField');
  const secondary = document.querySelector('#secondaryLink');
  const forgot = document.querySelector('#forgotLink');
  const back = document.querySelector('#backLink');
  const emailInput = form.elements.email;
  const passwordInput = form.elements.password;
  const allowedNext = new URLSearchParams(location.search).get('next');
  const next = allowedNext && allowedNext.startsWith('/') && !allowedNext.startsWith('//') ? allowedNext : '/app';
  const showNotice = (message, kind = 'success') => { notice.textContent = message; notice.dataset.kind = kind; notice.hidden = false; };
  const hide = (element, value) => { element.hidden = value; };
  const send = async (path, body, method = 'POST') => {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
    return data;
  };
  const route = {
    login: { title: 'Entre na sua conta', description: 'Acesse suas transcrições e continue de onde parou.', button: 'Entrar', showPassword: true, secondary: ['Criar uma conta', '/register'], forgot: true },
    register: { title: 'Crie sua conta', description: 'Salve transcrições e acesse seu espaço em qualquer dispositivo.', button: 'Criar conta', showName: true, showPassword: true, secondary: ['Já tenho uma conta', '/login'] },
    'forgot-password': { title: 'Recupere o acesso', description: 'Enviaremos um link para redefinir sua senha.', button: 'Enviar link', secondary: ['Voltar para entrar', '/login'] },
    'reset-password': { title: 'Defina uma nova senha', description: 'Escolha uma senha com pelo menos 8 caracteres.', button: 'Salvar senha', showPassword: true, showConfirm: true, secondary: ['Voltar para entrar', '/login'] }
  }[page] || null;
  if (!route) return;
  title.textContent = route.title; description.textContent = route.description; submit.firstChild.textContent = route.button + ' ';
  hide(nameField, !route.showName); hide(passwordField, !route.showPassword); hide(confirmField, !route.showConfirm);
  if (route.showPassword) passwordInput.required = true; else passwordInput.required = false;
  if (route.secondary) { secondary.textContent = route.secondary[0]; secondary.href = route.secondary[1]; } else hide(secondary, true);
  hide(forgot, !route.forgot); hide(back, page !== 'reset-password');
  if (page === 'register') passwordInput.autocomplete = 'new-password';
  if (page === 'forgot-password') { emailInput.required = true; }
  if (new URLSearchParams(location.search).has('confirmed')) showNotice('E-mail confirmado. Entre para abrir seu espaço.');

  async function acceptAuthHash() {
    if (!location.hash) return;
    const hash = new URLSearchParams(location.hash.slice(1));
    const accessToken = hash.get('access_token'), refreshToken = hash.get('refresh_token');
    const type = hash.get('type');
    if (!accessToken || !refreshToken) return;
    if (type === 'recovery' && page !== 'reset-password') return;
    if (type !== 'recovery' && !(type === 'signup' && ['login', 'register'].includes(page))) return;
    await send('/api/auth/recovery-session', { accessToken, refreshToken });
    history.replaceState(null, '', location.pathname);
    if (type === 'signup') { location.replace('/app'); return; }
    showNotice('Link verificado. Defina sua nova senha.');
  }
  acceptAuthHash().catch(error => showNotice(error.message, 'error'));

  fetch('/api/auth/session').then(response => { if (response.ok && ['login', 'register'].includes(page)) location.replace(next); }).catch(() => {});
  fetch('/api/config').then(response => response.json()).then(config => {
    if (!config.supabaseConfigured) showNotice('O servidor ainda precisa das credenciais do Supabase no .env.', 'error');
  }).catch(() => showNotice('Não foi possível conectar ao servidor Vozia.', 'error'));

  form.addEventListener('submit', async event => {
    event.preventDefault(); notice.hidden = true; submit.disabled = true;
    try {
      const values = new FormData(form); const email = String(values.get('email') || '').trim(); const password = String(values.get('password') || '');
      if (page === 'login') { await send('/api/auth/login', { email, password }); location.assign(next); return; }
      if (page === 'register') {
        const result = await send('/api/auth/register', { name: String(values.get('name') || '').trim(), email, password });
        if (result.authenticated) { location.assign('/app'); return; }
        showNotice('Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre.'); return;
      }
      if (page === 'forgot-password') { await send('/api/auth/recover', { email }); showNotice('Se a conta existir, enviaremos um link de recuperação.'); return; }
      if (page === 'reset-password') {
        if (password.length < 8 || password !== values.get('confirmPassword')) throw new Error('As senhas precisam coincidir e ter pelo menos 8 caracteres.');
        await send('/api/auth/password', { password }, 'PUT'); await send('/api/auth/logout', {}); showNotice('Senha atualizada. Entre com sua nova senha.'); setTimeout(() => location.assign('/login'), 1100);
      }
    } catch (error) { showNotice(error.message, 'error'); }
    finally { submit.disabled = false; }
  });
})();
