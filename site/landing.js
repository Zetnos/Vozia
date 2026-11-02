(() => {
  const menuButton = document.querySelector('#navToggle');
  const nav = document.querySelector('#siteNav');

  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    nav?.classList.toggle('is-open', open);
  });
  nav?.addEventListener('click', event => {
    if (!event.target.closest('a')) return;
    nav.classList.remove('is-open');
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', 'Abrir menu');
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !nav?.classList.contains('is-open')) return;
    nav.classList.remove('is-open');
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', 'Abrir menu');
    menuButton?.focus();
  });

  const workspaceLinks = [...document.querySelectorAll('[data-workspace-entry]')];
  window.VoziaAuth?.validSession().then(session => {
    if (!session) return;
    workspaceLinks.forEach(link => {
      link.href = '/app';
    });
    document.querySelectorAll('.workspace-entry-link').forEach(link => {
      const textNode = [...link.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (textNode) textNode.textContent = ' Abrir dashboard ';
    });
  }).catch(() => {});

  if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches && 'IntersectionObserver' in window) {
    const iconObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        iconObserver.unobserve(entry.target);
      }
    }, { threshold: 0.35, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.category-section').forEach(section => iconObserver.observe(section));
  }
})();
