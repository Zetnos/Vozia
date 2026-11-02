# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing plain HTML, CSS, and JavaScript frontend with a Node.js server and a local Python Whisper worker.

## Users

People who need to transcribe audio or video recordings, including long files.

## Product Purpose

Vozia turns audio and video recordings into timestamped text that people can review alongside the original media and export as subtitles.

## Positioning

Vozia runs Whisper locally in its server environment and accepts large recordings through chunked uploads, then connects the transcript to the media player and SRT export.

## Operating Context

Visitors choose a local audio or video file, select or detect a language, wait for transcription, then review synchronized segments with the player and export a subtitle file or copy the text. The current workspace and profile are browser-local.

## Capabilities and Constraints

- The server uses the installed Whisper implementation and Python worker for transcription.
- Uploads are sent in 8 MB chunks so files larger than 100 MB do not depend on one request.
- Supported input formats include MP3, WAV, M4A, MP4, AAC, OGG, FLAC, and WebM.
- Language choices include Portuguese, English, Spanish, French, German, Italian, and Japanese, plus automatic detection.
- Transcriptions contain timestamped segments; the player can seek from transcript segments and show synchronized video captions.
- Users can export SRT and copy plain transcript text.
- The current profile and workspace are local to the browser; do not describe them as synced accounts or cloud storage.
- The current project does not provide published customer proof, performance guarantees, or a payment flow.

## Brand Commitments

- The product name is Vozia.
- The user asked to preserve the charcoal/dark and lime palette from their referenced stylesheet.
- Keep the ten product categories as separate sections on the landing page.
- For future product landing pages, the user prefers the familiar category standard, executed at high craft, over an unconventional visual metaphor.
- Write the interface in Brazilian Portuguese.

## Evidence on Hand

- Runnable product interface: `index.html`, `app.js`, `styles.css`, and `theme.css`.
- Local transcription worker: `whisper_worker.py`.
- Server and upload flow: `server.js`.
- No supplied testimonials, client logos, or verified performance benchmarks.

## Product Principles

- Make the transcription workflow easy to understand before asking for a file.
- Be clear that Whisper runs in the Vozia server environment.
- Show that long files are supported through chunked upload.
- Keep the source media and its transcript connected during review.
- Make useful export formats easy to find.
