# Vozia

Landing page pública da Vozia, publicada no GitHub Pages via GitHub Actions.

O GitHub Pages hospeda HTML, CSS e JavaScript estáticos. A transcrição real com Whisper exige o servidor Node.js/Python em uma hospedagem separada. A página pública explica essa limitação ao tentar enviar um arquivo. Nenhum `.env`, áudio, modelo Whisper ou dado local é publicado.

## Migração do Supabase

O esquema de perfis e transcrições está versionado em `supabase/migrations/202611020001_vozia_accounts.sql`. Essa migração já foi executada no projeto Supabase da Vozia. Para aplicá-la em outro projeto, execute o SQL pelo Editor SQL do Supabase ou use a Supabase CLI.

## Deploy no Vercel

O projeto Vercel `vozia` está conectado ao repositório `Zetnos/Vozia` e usa `site/` como diretório raiz, sem comando de build. Commits na branch `main` acionam deploy automático. O GitHub Pages continua usando a mesma pasta estática.

A landing da pasta `site/` é publicada no Vercel. O servidor Node/Python do Vozia está versionado na raiz e empacotado no `Dockerfile`; ele precisa rodar em um serviço de containers com volume persistente montado em `/app/uploads`, pois guarda os uploads e a fila localmente. O Vercel continua responsável pela landing estática e não executa esse processo persistente.

### Publicar o servidor Whisper

1. Crie um serviço Docker usando este repositório e o `Dockerfile` da raiz. Configure o serviço para ouvir a porta `3000` e monte um volume persistente em `/app/uploads`.
2. Defina no serviço `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `PUBLIC_URL` e uma senha forte em `ADMIN_PASSWORD`. Não coloque segredos no GitHub nem no Vercel como variáveis públicas.
3. Configure o endereço público do serviço como a aplicação principal do Vozia. A landing da Vercel permanece uma publicação separada até receber esse endereço para encaminhar login e transcrição ao servidor.

O worker usa Whisper local em CPU e baixa o modelo escolhido na primeira transcrição. Os arquivos e a fila dependem de armazenamento persistente; a landing estática, por si só, não executa `/api/*` nem Whisper.
