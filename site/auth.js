(() => {
  const pageNames = ['login', 'register', 'forgot-password', 'reset-password'];
  const routePage = location.pathname.replace(/^\/+|\/+$/g, '');
  const page = new URLSearchParams(location.search).get('page') || (pageNames.includes(routePage) ? routePage : document.body.dataset.page);
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
  const params = new URLSearchParams(location.search);
  const nextPath = params.get('next');
  const next = nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/app';
  const showNotice = (message, kind = 'success') => { notice.textContent = message; notice.dataset.kind = kind; notice.hidden = false; };
  const hide = (element, value) => { element.hidden = value; };
  const routes = {
    login: { title: 'Entre na sua conta', description: 'Acesse suas transcrições e continue de onde parou.', button: 'Entrar', showPassword: true, secondary: ['Criar uma conta', '/register'], forgot: true },
    register: { title: 'Crie sua conta', description: 'Salve transcrições e acesse seu espaço em qualquer dispositivo.', button: 'Criar conta', showName: true, showPassword: true, secondary: ['Já tenho uma conta', '/login'] },
    'forgot-password': { title: 'Recupere o acesso', description: 'Enviaremos um link para redefinir sua senha.', button: 'Enviar link', secondary: ['Voltar para entrar', '/login'] },
    'reset-password': { title: 'Defina uma nova senha', description: 'Escolha uma senha com pelo menos 8 caracteres.', button: 'Salvar senha', showPassword: true, showConfirm: true, secondary: ['Voltar para entrar', '/login'] }
  };
  const route = routes[page];
  if (!route) return;
  title.textContent = route.title;
  description.textContent = route.description;
  submit.firstChild.textContent = `${route.button} `;
  hide(nameField, !route.showName);
  hide(passwordField, !route.showPassword);
  hide(confirmField, !route.showConfirm);
  passwordInput.required = Boolean(route.showPassword);
  emailInput.required = page !== 'reset-password';
  if (route.secondary) { secondary.textContent = route.secondary[0]; secondary.href = route.secondary[1]; }
  else hide(secondary, true);
  hide(forgot, !route.forgot);
  hide(back, page !== 'reset-password');
  if (page === 'register') passwordInput.autocomplete = 'new-password';
  if (params.has('confirmed')) showNotice('E-mail confirmado. Entre para abrir seu espaço.');

  async function acceptAuthHash() {
    if (!location.hash) return;
    const hash = new URLSearchParams(location.hash.slice(1));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    if (!accessToken || !refreshToken) return;
    const session = VoziaAuth.saveSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: hash.get('expires_in') || 3600 });
    const type = hash.get('type');
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    if (type === 'signup') { location.replace(next); return; }
    if (type === 'recovery' && page !== 'reset-password') { location.replace('/reset-password'); return; }
    if (type === 'recovery') showNotice('Link verificado. Defina sua nova senha.');
    if (!type && session && ['login', 'register'].includes(page)) location.replace(next);
  }

  acceptAuthHash().catch(error => showNotice(error.message, 'error'));
  if (['login', 'register'].includes(page) && !location.hash) {
    VoziaAuth.validSession().then(session => { if (session) location.replace(next); }).catch(() => {});
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    notice.hidden = true;
    submit.disabled = true;
    const values = new FormData(form);
    const email = String(values.get('email') || '').trim();
    const password = String(values.get('password') || '');
    try {
      if (page === 'login') {
        await VoziaAuth.signIn({ email, password });
        location.assign(next);
      } else if (page === 'register') {
        const result = await VoziaAuth.signUp({ email, password, name: String(values.get('name') || '').trim() });
        if (result.access_token) { location.assign('/app'); return; }
        showNotice('Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre.');
      } else if (page === 'forgot-password') {
        await VoziaAuth.recover(email);
        showNotice('Se a conta existir, enviaremos um link de recuperação.');
      } else if (page === 'reset-password') {
        if (password.length < 8 || password !== values.get('confirmPassword')) throw new Error('As senhas precisam coincidir e ter pelo menos 8 caracteres.');
        await VoziaAuth.updatePassword(password);
        await VoziaAuth.signOut();
        showNotice('Senha atualizada. Entre com sua nova senha.');
        setTimeout(() => location.assign('/login'), 1100);
      }
    } catch (error) {
      const message = error.message === 'Failed to fetch'
        ? 'Não foi possível alcançar o Supabase. Verifique a configuração de URL e chave pública.'
        : error.message;
      showNotice(message, 'error');
    } finally {
      submit.disabled = false;
    }
  });
})();
