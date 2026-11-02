# Vozia

Landing page pública da Vozia, publicada no GitHub Pages via GitHub Actions.

O GitHub Pages hospeda HTML, CSS e JavaScript estáticos. A transcrição real com Whisper exige o servidor Node.js/Python em uma hospedagem separada. A página pública explica essa limitação ao tentar enviar um arquivo. Nenhum `.env`, áudio, modelo Whisper ou dado local é publicado.

## Migração do Supabase

O esquema de perfis e transcrições está versionado em `supabase/migrations/202611020001_vozia_accounts.sql`. Essa migração já foi executada no projeto Supabase da Vozia. Para aplicá-la em outro projeto, execute o SQL pelo Editor SQL do Supabase ou use a Supabase CLI.
