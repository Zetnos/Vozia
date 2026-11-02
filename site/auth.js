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
  const formKicker = document.querySelector('#formKicker');
  const resendButton = document.querySelector('#resendConfirmation');
  const nameInput = form.elements.name;
  const emailInput = form.elements.email;
  const passwordInput = form.elements.password;
  const confirmInput = form.elements.confirmPassword;
  const params = new URLSearchParams(location.search);
  const nextPath = params.get('next');
  const next = nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/app';
  const showNotice = (message, kind = 'success') => { notice.textContent = message; notice.dataset.kind = kind; notice.hidden = false; };
  const hide = (element, value) => { element.hidden = value; };
  const routes = {
    login: { title: 'Entre na sua conta', description: 'Acesse suas transcrições e continue de onde parou.', button: 'Entrar', showPassword: true, secondary: ['Criar uma conta', '/register'], forgot: true },
    register: { title: 'Crie sua conta', description: 'Salve transcrições e acesse seu espaço em qualquer dispositivo.', button: 'Criar conta', showName: true, showPassword: true, secondary: ['Já tenho uma conta', '/login'] },
    'forgot-password': { title: 'Recupere o acesso', description: 'Informe seu e-mail. Se houver uma conta, enviaremos um link para criar outra senha.', button: 'Enviar link de recuperação', secondary: ['Voltar para entrar', '/login'] },
    'reset-password': { title: 'Defina uma nova senha', description: 'Escolha uma senha com pelo menos 8 caracteres.', button: 'Salvar nova senha', showPassword: true, showConfirm: true, secondary: ['Voltar para entrar', '/login'] }
  };
  const route = routes[page];
  if (!route) return;
  document.title = `${route.title} · Vozia`;
  const kickers = { login: 'BEM-VINDO DE VOLTA', register: 'COMECE COM A VOZIA', 'forgot-password': 'RECUPERE SEU ACESSO', 'reset-password': 'QUASE LÁ' };
  formKicker.textContent = kickers[page] || 'SUA CONTA VOZIA';
  title.textContent = route.title;
  description.textContent = route.description;
  submit.firstChild.textContent = `${route.button} `;
  hide(nameField, !route.showName);
  hide(passwordField, !route.showPassword);
  hide(confirmField, !route.showConfirm);
  nameInput.required = Boolean(route.showName);
  passwordInput.required = Boolean(route.showPassword);
  confirmInput.required = Boolean(route.showConfirm);
  emailInput.required = page !== 'reset-password';
  resendButton.hidden = true;
  document.querySelector('#passwordHint').textContent = page === 'register' || page === 'reset-password' ? 'Pelo menos 8 caracteres. Use uma senha que você ainda não usa em outro serviço.' : 'A senha precisa ter pelo menos 8 caracteres.';
  if (route.secondary) { secondary.textContent = route.secondary[0]; secondary.href = route.secondary[1]; }
  else hide(secondary, true);
  hide(forgot, !route.forgot);
  hide(back, page !== 'reset-password');
  if (page === 'register') passwordInput.autocomplete = 'new-password';
  if (params.has('confirmed')) showNotice('E-mail confirmado. Entre para abrir seu espaço.');

  for (const toggle of document.querySelectorAll('[data-password-toggle]')) {
    toggle.addEventListener('click', () => {
      const input = form.elements[toggle.dataset.passwordToggle];
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      toggle.setAttribute('aria-label', reveal ? 'Ocultar senha' : 'Mostrar senha');
      toggle.title = reveal ? 'Ocultar senha' : 'Mostrar senha';
    });
  }
  const wave = document.querySelector('.signal-wave');
  for (let i = 0; i < 54; i++) {
    const bar = document.createElement('i');
    const envelope = .28 + .72 * Math.abs(Math.sin(i * .21));
    const peak = Math.abs(Math.sin(i * 1.37) * Math.cos(i * .31));
    bar.style.setProperty('--wave-height', `${Math.max(6, Math.round((7 + peak * 39) * envelope))}px`);
    bar.style.setProperty('--wave-delay', `${-(i % 11) * 95}ms`);
    wave.appendChild(bar);
  }

  function friendlyError(error) {
    const code = String(error.code || '').toLowerCase();
    const message = String(error.message || 'Não foi possível concluir a solicitação.');
    const lower = message.toLowerCase();
    if (code.includes('otp_expired') || lower.includes('email link is invalid') || lower.includes('token has expired') || lower.includes('invalid or has expired')) return 'Este link expirou ou já foi usado. Solicite um novo e-mail e abra o link mais recente.';
    if (code.includes('email_not_confirmed') || lower.includes('email not confirmed')) return 'Este e-mail ainda não foi confirmado. Reenvie a confirmação e abra o link recebido antes de entrar.';
    if (lower.includes('email address not authorized')) return 'O Supabase não está autorizado a enviar para este endereço. O SMTP padrão só entrega para endereços da equipe; configure um SMTP próprio no Supabase.';
    if (code.includes('over_email_send_rate_limit') || lower.includes('rate limit') || lower.includes('too many requests')) return 'O limite de envio de e-mails foi atingido. Aguarde antes de tentar de novo ou configure um SMTP próprio no Supabase.';
    if (lower === 'failed to fetch') return 'Não foi possível alcançar o Supabase. Confira a conexão e tente novamente.';
    return message;
  }

  function showResend(email = '') {
    if (email) emailInput.value = email;
    resendButton.textContent = page === 'reset-password' ? 'Não recebeu o e-mail? Reenviar recuperação' : 'Não recebeu o e-mail? Reenviar confirmação';
    resendButton.hidden = false;
  }

  async function acceptAuthCallback() {
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const callbackError = query.get('error_description') || query.get('error_code') || hash.get('error_description') || hash.get('error_code') || query.get('error') || hash.get('error');
    if (callbackError) {
      const parsed = new Error(String(callbackError).replace(/\+/g, ' '));
      parsed.code = query.get('error_code') || hash.get('error_code') || query.get('error') || hash.get('error') || '';
      showNotice(friendlyError(parsed), 'error');
      if (page === 'reset-password' || page === 'login' || page === 'register') showResend(query.get('email') || hash.get('email') || '');
      const clean = new URL(location.href);
      ['error', 'error_code', 'error_description'].forEach(key => clean.searchParams.delete(key));
      history.replaceState(null, '', clean.pathname + clean.search);
      return true;
    }

    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    if (accessToken && refreshToken) {
      const session = VoziaAuth.saveSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: hash.get('expires_in') || 3600 });
      const type = hash.get('type');
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      if (type === 'signup') { location.replace(next); return; }
      if (type === 'recovery' && page !== 'reset-password') { location.replace('/reset-password'); return; }
      if (type === 'recovery') showNotice('E-mail confirmado. Defina sua nova senha abaixo.');
      if (!type && session && ['login', 'register'].includes(page)) { location.replace(next); return; }
    }
    if (params.has('confirmed')) showNotice('E-mail confirmado. Agora entre para abrir seu espaço.');
    return false;
  }

  async function initializeRoute() {
    const callbackFailed = await acceptAuthCallback();
    if (['login', 'register'].includes(page) && !location.hash && !params.has('confirmed')) {
      const session = await VoziaAuth.validSession();
      if (session) { location.replace(next); return; }
    }
    if (!callbackFailed && page === 'reset-password' && !location.hash && !VoziaAuth.readSession()) {
      showNotice('Abra o link de recuperação enviado ao seu e-mail. Se ele expirou, solicite outro na tela anterior.', 'error');
    }
  }
  initializeRoute().catch(error => showNotice(friendlyError(error), 'error'));

  resendButton.addEventListener('click', async () => {
    notice.hidden = true;
    const email = String(emailInput.value || '').trim();
    if (!email || !emailInput.validity.valid) {
      showNotice('Digite um endereço de e-mail válido para reenviar a confirmação.', 'error');
      emailInput.focus();
      return;
    }
    resendButton.disabled = true;
    const isRecovery = page === 'reset-password';
    resendButton.textContent = isRecovery ? 'Enviando recuperação…' : 'Enviando confirmação…';
    try {
      if (isRecovery) {
        await VoziaAuth.recover(email);
        showNotice('Se houver uma conta para este endereço, enviaremos um novo link de recuperação. Confira também o spam e abra a mensagem mais recente.');
      } else {
        await VoziaAuth.resendSignupConfirmation(email);
        showNotice('Se o cadastro estiver aguardando confirmação, enviaremos outro link. Confira também o spam e abra a mensagem mais recente.');
      }
    } catch (error) {
      showNotice(friendlyError(error), 'error');
    } finally {
      resendButton.disabled = false;
      resendButton.textContent = isRecovery ? 'Não recebeu o e-mail? Reenviar recuperação' : 'Não recebeu o e-mail? Reenviar confirmação';
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    notice.hidden = true;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submit.firstChild.textContent = ({ login: 'Entrando ', register: 'Criando conta ', 'forgot-password': 'Enviando link ', 'reset-password': 'Salvando senha ' })[page] || 'Aguarde ';
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
        showNotice('Se o endereço ainda não estiver cadastrado, enviaremos um link de confirmação. Confira sua caixa de entrada e o spam.');
        showResend(email);
      } else if (page === 'forgot-password') {
        await VoziaAuth.recover(email);
        showNotice('Se houver uma conta para este endereço, enviaremos um link de recuperação. Confira também o spam e abra a mensagem mais recente.');
      } else if (page === 'reset-password') {
        if (password.length < 8 || password !== values.get('confirmPassword')) throw new Error('As senhas precisam coincidir e ter pelo menos 8 caracteres.');
        await VoziaAuth.updatePassword(password);
        await VoziaAuth.signOut();
        showNotice('Senha atualizada. Entre com sua nova senha.');
        setTimeout(() => location.assign('/login'), 1100);
      }
    } catch (error) {
      if (page === 'login' && /email_not_confirmed|email not confirmed/i.test(`${error.code || ''} ${error.message || ''}`)) showResend(email);
      showNotice(friendlyError(error), 'error');
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      submit.firstChild.textContent = `${route.button} `;
    }
  });
})();
