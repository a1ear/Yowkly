# Scan worker: ClamAV daemon + the Node job loop in one small machine.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends clamav clamav-daemon clamav-freshclam tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /run/clamav && chown clamav:clamav /run/clamav

COPY worker/clamd.conf /etc/clamav/clamd.conf
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY worker ./worker

ENV NODE_ENV=production CLAMD_HOST=127.0.0.1 CLAMD_PORT=3310
# Fetch signatures, start clamd, keep signatures fresh, then run the loop.
CMD ["tini", "--", "sh", "-c", "freshclam --stdout && (freshclam -d --checks=12 &) && clamd && node worker/scan.mjs"]
