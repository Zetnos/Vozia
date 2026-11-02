(() => {
  const menuButton = document.querySelector('#navToggle');
  const nav = document.querySelector('#siteNav');
  const form = document.querySelector('#transcricao');
  const input = document.querySelector('#landingFile');
  const drop = document.querySelector('#fileDrop');
  const chooseButton = document.querySelector('#chooseFile');
  const clearButton = document.querySelector('#clearFile');
  const submit = document.querySelector('#submitUpload');
  const status = document.querySelector('#uploadStatus');
  const progress = document.querySelector('#uploadProgress');
  const progressBar = document.querySelector('#uploadProgressBar');
  let selectedFile = null;
  let busy = false;

  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    nav.classList.toggle('is-open', open);
  });
  nav?.addEventListener('click', event => {
    if (event.target.closest('a')) {
      nav.classList.remove('is-open');
      menuButton?.setAttribute('aria-expanded', 'false');
      menuButton?.setAttribute('aria-label', 'Abrir menu');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav?.classList.contains('is-open')) {
      nav.classList.remove('is-open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Abrir menu');
      menuButton.focus();
    }
  });

  const formatSize = bytes => bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(2) + ' GB' : (bytes / 1024 ** 2).toFixed(1) + ' MB';
  const validFile = file => /\.(mp3|wav|m4a|mp4|aac|ogg|flac|webm)$/i.test(file.name) || file.type.startsWith('audio/') || file.type.startsWith('video/');
  const announce = (message, state = '') => {
    status.textContent = message;
    status.dataset.state = state;
  };
  if (location.hostname.endsWith('github.io')) announce('Demonstração pública. Transcrições reais precisam do servidor Vozia com Whisper conectado.');

  const setFile = file => {
    if (!file) return;
    if (!validFile(file)) {
      announce('Esse formato não é compatível. Escolha áudio ou vídeo em MP3, WAV, M4A, MP4, AAC, OGG, FLAC ou WebM.', 'error');
      return;
    }
    selectedFile = file;
    document.querySelector('#dropTitle').textContent = file.name;
    document.querySelector('#selectedName').textContent = file.name;
    document.querySelector('#selectedMeta').textContent = formatSize(file.size) + ' · ' + (file.type || 'arquivo de mídia');
    document.querySelector('#selectedFile').hidden = false;
    document.querySelector('#fileFormats').hidden = true;
    submit.disabled = false;
    announce(file.size > 100 * 1024 * 1024 ? 'Arquivo grande selecionado · será enviado em partes de 8 MB.' : 'Arquivo pronto para transcrever.');
  };
  const clearFile = () => {
    selectedFile = null;
    input.value = '';
    document.querySelector('#dropTitle').textContent = 'Arraste o arquivo até aqui';
    document.querySelector('#selectedFile').hidden = true;
    document.querySelector('#fileFormats').hidden = false;
    submit.disabled = true;
    announce('Arquivos grandes são enviados em partes de 8 MB.');
  };

  chooseButton.addEventListener('click', () => input.click());
  input.addEventListener('change', () => setFile(input.files?.[0]));
  clearButton.addEventListener('click', clearFile);
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('is-dragging'); });
  drop.addEventListener('dragleave', event => { if (!drop.contains(event.relatedTarget)) drop.classList.remove('is-dragging'); });
  drop.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('is-dragging');
    setFile(event.dataTransfer?.files?.[0]);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!selectedFile || busy) return;
    if (location.hostname.endsWith('github.io')) {
      announce('A página pública está no ar. Para transcrever, é necessário conectar um servidor Vozia com Whisper; veja as instruções no repositório.', 'error');
      return;
    }
    busy = true;
    submit.disabled = true;
    submit.innerHTML = 'Preparando envio <span aria-hidden="true">…</span>';
    progress.hidden = false;
    announce('Conectando ao servidor local da Vozia…');
    try {
      const healthResponse = await fetch('/api/health');
      const health = await healthResponse.json();
      if (!healthResponse.ok || health.server === 'offline') throw new Error('O servidor da Vozia está offline. Inicie o servidor e tente novamente.');
      if (health.whisperInstalled === false) throw new Error('O Whisper não está instalado neste servidor. Confira a instalação local e tente novamente.');
      let workspaceId = '';
      try {
        workspaceId = localStorage.getItem('voziaWorkspaceId') || crypto.randomUUID();
        localStorage.setItem('voziaWorkspaceId', workspaceId);
      } catch {}
      const startResponse = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedFile.name,
          size: selectedFile.size,
          type: selectedFile.type || 'application/octet-stream',
          language: document.querySelector('#landingLanguage').value,
          project: 'Nova transcrição',
          workspaceId
        })
      });
      const startData = await startResponse.json();
      if (!startResponse.ok) throw new Error(startData.error || 'Não foi possível iniciar o envio do arquivo.');
      const total = Math.ceil(selectedFile.size / startData.chunkSize);
      for (let index = 0; index < total; index++) {
        const part = selectedFile.slice(index * startData.chunkSize, Math.min(selectedFile.size, (index + 1) * startData.chunkSize));
        const response = await fetch('/api/uploads/' + startData.id + '/chunks/' + index, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: part
        });
        if (!response.ok) throw new Error('Falha ao enviar a parte ' + (index + 1) + ' de ' + total + '. Tente novamente.');
        const percent = Math.round((index + 1) / total * 100);
        progressBar.style.transform = 'scaleX(' + percent / 100 + ')';
        announce('Enviando parte ' + (index + 1) + ' de ' + total + ' · ' + percent + '%');
      }
      const complete = await fetch('/api/uploads/' + startData.id + '/complete', { method: 'POST' });
      const result = await complete.json();
      if (!complete.ok) throw new Error(result.error || 'Não foi possível finalizar o envio.');
      announce('Arquivo recebido. Abrindo sua transcrição…', 'success');
      submit.innerHTML = 'Abrindo a transcrição <span aria-hidden="true">→</span>';
      window.location.assign('/app?job=' + encodeURIComponent(startData.id));
    } catch (error) {
      announce(error.message || 'Não foi possível enviar o arquivo. Confira sua conexão com o servidor e tente novamente.', 'error');
      submit.disabled = false;
      submit.innerHTML = 'Tentar novamente <span aria-hidden="true">→</span>';
      busy = false;
    }
  });

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

  const demoPanel = document.querySelector('#demoPanel');
  if (demoPanel) {
    const demoTabs = [...document.querySelectorAll('.demo-tab')];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const transcriptExample = 'A conversa fica organizada e pronta para continuar o trabalho.';
    const subtitleExample = '1\n00:00:04,000 --> 00:00:08,000\nQuando a gente escuta com atenção...\n\n2\n00:00:08,200 --> 00:00:12,000\n' + transcriptExample + '\n';
    let demoUploadTimer = null;
    let demoSyncTimer = null;
    let demoPlaying = true;
    const clearDemoTimers = () => {
      clearInterval(demoUploadTimer);
      clearInterval(demoSyncTimer);
      demoUploadTimer = null;
      demoSyncTimer = null;
      demoPlaying = true;
    };

    const demoContent = {
      upload: '<div class="demo-upload"><div class="demo-file"><span class="demo-file-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/><path d="M14 3v6h6M8 14h.1M11 14h.1M14 14h.1M17 14h.1"/></svg></span><span class="demo-file-name"><b>entrevista-equipe.mp4</b><small>Arquivo de exemplo · 142 MB · MP4</small></span><span class="demo-file-size">142 MB</span></div><div class="demo-status"><span id="uploadState">Preparando envio em partes…</span><b id="uploadCount">0 de 8 partes</b></div><div class="chunk-track" aria-label="Progresso ilustrativo de envio">' + Array.from({length: 8}, (_, i) => '<span class="chunk-block" data-chunk="' + (i + 1) + '">0' + (i + 1) + '</span>').join('') + '</div><div class="demo-progress"><span id="demoProgress"></span></div><div class="demo-foot"><span>Envio dividido para arquivos grandes</span><button type="button" class="demo-inline-action" id="restartUpload">Repetir animação</button></div></div>',
      sync: '<div class="demo-sync"><div class="demo-media"><div class="demo-media-title"><b>entrevista-equipe.mp4</b><span id="syncTime">00:04 / 10:43</span></div><div class="demo-wave" id="demoWave" aria-hidden="true"></div><div class="demo-player-controls"><button class="demo-play" id="togglePlay" type="button" aria-label="Pausar prévia"><svg id="toggleIcon" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg></button><span class="demo-track"><span id="demoTrack"></span></span><span class="demo-duration">10:43</span></div></div><div class="demo-transcript" aria-label="Trechos de transcrição sincronizados"><div class="demo-transcript-row active"><time>00:04–00:08</time><span>Quando a gente escuta com atenção, as ideias começam a ganhar forma.</span></div><div class="demo-transcript-row"><time>00:08–00:12</time><span>' + transcriptExample + '</span></div><div class="demo-transcript-row"><time>00:12–00:17</time><span>Assim fica mais simples encontrar cada momento da gravação.</span></div></div></div>',
      export: '<div class="demo-export"><pre class="srt-preview" id="srtPreview"></pre><div class="export-controls"><button type="button" id="downloadSrt">Baixar .SRT</button><button type="button" id="copyTranscript">Copiar texto</button><p class="export-notice" id="exportNotice" role="status" aria-live="polite"></p></div></div>'
    };

    function animateDemoUpload() {
      clearInterval(demoUploadTimer);
      const blocks = [...demoPanel.querySelectorAll('.chunk-block')];
      const progress = demoPanel.querySelector('#demoProgress');
      const state = demoPanel.querySelector('#uploadState');
      const count = demoPanel.querySelector('#uploadCount');
      if (!blocks.length) return;
      let complete = 0;
      blocks.forEach(block => block.classList.remove('done', 'current'));
      progress.style.width = '0%';
      if (reducedMotion) {
        blocks.forEach(block => block.classList.add('done'));
        progress.style.width = '100%';
        state.textContent = 'Arquivo pronto para transcrição';
        count.textContent = '8 de 8 partes';
        return;
      }
      state.textContent = 'Preparando envio em partes…';
      count.textContent = '0 de 8 partes';
      demoUploadTimer = setInterval(() => {
        if (complete > 0) blocks[complete - 1].classList.replace('current', 'done');
        if (complete < blocks.length) blocks[complete].classList.add('current');
        complete++;
        progress.style.width = Math.min(100, complete / blocks.length * 100) + '%';
        count.textContent = Math.min(complete, 8) + ' de 8 partes';
        state.textContent = complete >= 8 ? 'Arquivo pronto para transcrição' : 'Enviando partes do arquivo…';
        if (complete >= 8) {
          blocks[7].classList.replace('current', 'done');
          clearInterval(demoUploadTimer);
        }
      }, 470);
    }

    function renderDemo(step) {
      clearDemoTimers();
      demoPanel.innerHTML = demoContent[step];
      demoPanel.setAttribute('aria-labelledby', 'tab-' + step);
      demoTabs.forEach(tab => {
        const active = tab.dataset.demoStep === step;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      if (step === 'upload') {
        animateDemoUpload();
        demoPanel.querySelector('#restartUpload').addEventListener('click', animateDemoUpload);
      }
      if (step === 'sync') {
        const wave = demoPanel.querySelector('#demoWave');
        for (let i = 0; i < 58; i++) {
          const bar = document.createElement('i');
          bar.className = 'demo-wave-bar';
          bar.style.setProperty('--bar-height', (8 + Math.abs(Math.sin(i * 1.72) * 52)) + 'px');
          bar.style.setProperty('--delay', (-(i % 9) * 110) + 'ms');
          wave.appendChild(bar);
        }
        if (!reducedMotion) {
          let current = 0;
          demoSyncTimer = setInterval(() => {
            if (!demoPlaying) return;
            current = (current + 1) % 3;
            demoPanel.querySelectorAll('.demo-transcript-row').forEach((row, i) => row.classList.toggle('active', i === current));
            demoPanel.querySelector('#syncTime').textContent = ['00:04', '00:08', '00:12'][current] + ' / 10:43';
            demoPanel.querySelector('#demoTrack').style.width = [35, 52, 69][current] + '%';
          }, 2400);
        }
        demoPanel.querySelector('#togglePlay').addEventListener('click', event => {
          demoPlaying = !demoPlaying;
          const button = event.currentTarget;
          button.setAttribute('aria-label', demoPlaying ? 'Pausar prévia' : 'Retomar prévia');
          button.classList.toggle('paused', !demoPlaying);
          demoPanel.querySelector('#toggleIcon').innerHTML = demoPlaying ? '<path d="M8 5v14M16 5v14"/>' : '<path d="m8 5 11 7-11 7z"/>';
          wave.classList.toggle('paused', !demoPlaying);
        });
      }
      if (step === 'export') {
        demoPanel.querySelector('#srtPreview').textContent = subtitleExample;
        demoPanel.querySelector('#downloadSrt').addEventListener('click', () => {
          const url = URL.createObjectURL(new Blob([subtitleExample], {type: 'application/x-subrip;charset=utf-8'}));
          const link = document.createElement('a');
          link.href = url; link.download = 'vozia-exemplo.srt'; link.click();
          URL.revokeObjectURL(url);
          demoPanel.querySelector('#exportNotice').textContent = 'Legenda de exemplo baixada.';
        });
        demoPanel.querySelector('#copyTranscript').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(transcriptExample); }
          catch {
            const area = document.createElement('textarea');
            area.value = transcriptExample; area.style.position = 'fixed'; area.style.opacity = '0';
            document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
          }
          demoPanel.querySelector('#exportNotice').textContent = 'Texto de exemplo copiado.';
        });
      }
    }

    demoTabs.forEach((tab, index) => {
      tab.addEventListener('click', () => renderDemo(tab.dataset.demoStep));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? demoTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + demoTabs.length) % demoTabs.length;
        demoTabs[next].focus();
        renderDemo(demoTabs[next].dataset.demoStep);
      });
    });
    renderDemo('upload');
    window.addEventListener('pagehide', clearDemoTimers);
  }
})();
