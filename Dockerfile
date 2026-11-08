# API image (Render / Fly / any Docker host). The web app deploys separately (Vercel).
FROM oven/bun:1.4.4

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production

ENV NODE_ENV=production
# Render sets PORT; the API reads API_PORT, then PORT.
EXPOSE 3001
CMD ["bun", "apps/api/src/index.ts"]
