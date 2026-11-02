import json
import sys
import contextlib
import io
import shutil

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main():
    if len(sys.argv) != 4:
        raise SystemExit("Uso: whisper_worker.py <arquivo> <idioma|auto> <modelo>")

    audio_path, language, model_name = sys.argv[1:]
    if not shutil.which("ffmpeg"):
        raise RuntimeError("FFmpeg não foi encontrado. Instale o FFmpeg e reinicie o servidor para atualizar o PATH.")
    import whisper

    # Whisper reports model-download progress to stderr. Keep it out of the
    # API's error message while still returning real exceptions as JSON.
    with contextlib.redirect_stderr(io.StringIO()):
        model = whisper.load_model(model_name)
    result = model.transcribe(
        audio_path,
        language=None if language == "auto" else language,
        task="transcribe",
        fp16=False,
        word_timestamps=True,
        # Whisper prints its detected language whenever verbose is False
        # (because False is not None); None keeps stdout as clean JSON.
        verbose=None,
    )
    segments = [
        {
            "start": float(segment["start"]),
            "end": float(segment["end"]),
            "text": segment["text"].strip(),
            "words": [
                {"start": float(word["start"]), "end": float(word["end"]), "text": word["word"]}
                for word in segment.get("words", [])
                if word.get("word", "").strip() and word.get("start") is not None and word.get("end") is not None
            ],
        }
        for segment in result.get("segments", [])
        if segment.get("text", "").strip()
    ]
    print(json.dumps({"text": result["text"].strip(), "language": result.get("language"), "segments": segments}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        raise SystemExit(1)
