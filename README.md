# Vozia

Landing page pública da Vozia, publicada no GitHub Pages via GitHub Actions.

O GitHub Pages hospeda HTML, CSS e JavaScript estáticos. A transcrição real com Whisper exige o servidor Node.js/Python em uma hospedagem separada. A página pública explica essa limitação ao tentar enviar um arquivo. Nenhum `.env`, áudio, modelo Whisper ou dado local é publicado.

## Migração do Supabase

O esquema de perfis e transcrições está versionado em `supabase/migrations/202611020001_vozia_accounts.sql`. Essa migração já foi executada no projeto Supabase da Vozia. Para aplicá-la em outro projeto, execute o SQL pelo Editor SQL do Supabase ou use a Supabase CLI.

## Deploy no Vercel

O projeto Vercel `vozia` está conectado ao repositório `Zetnos/Vozia` e usa `site/` como diretório raiz, sem comando de build. Commits na branch `main` acionam deploy automático. O GitHub Pages continua usando a mesma pasta estática.

A interface chama endpoints `/api` para upload e transcrição. O código desses endpoints e o worker Whisper ainda precisam ser implantados em um serviço de backend; a migração SQL do Supabase, sozinha, não fornece esses endpoints.
