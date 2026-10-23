FROM python:3.11-slim

# Install ffmpeg, Node.js, npm, and git
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg nodejs npm git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone and build bgutil-ytdlp-pot-provider background server and install plugins
RUN git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /pot && \
    cd /pot/server && \
    npm ci && \
    npx tsc && \
    mkdir -p /root/.yt-dlp-plugins && \
    cp -r /pot/yt_dlp_plugins /root/.yt-dlp-plugins/ && \
    cp -r /pot/yt_dlp_plugins /app/yt_dlp_plugins

# Copy and install backend Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application source code
COPY . .

# Expose port (Uvicorn listens on port 8000)
EXPOSE 8000

# Start POT provider on 127.0.0.1:4416 in background, then start Uvicorn
CMD ["sh", "-c", "node /pot/server/build/main.js & uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
