FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PYTHON_EXECUTABLE=/usr/bin/python3 \
    PYTHONUTF8=1 \
    WHISPER_MODEL=base

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git python3 python3-pip python3-venv build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json requirements.txt ./
RUN npm install --omit=dev --ignore-scripts \
    && python3 -m pip install --break-system-packages --no-cache-dir -r requirements.txt

COPY server.js supabase.js whisper_worker.py ./
COPY *.html *.css *.js *.svg ./
COPY supabase/migrations ./supabase/migrations

RUN mkdir -p /app/uploads /home/node/.cache/whisper \
    && chown -R node:node /app /home/node/.cache/whisper
USER node

VOLUME ["/app/uploads", "/home/node/.cache/whisper"]
EXPOSE 3000
CMD ["npm", "start"]
