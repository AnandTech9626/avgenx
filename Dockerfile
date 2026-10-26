# AVGENX Academy server. Build: docker build -t avgenx-academy .
# Run:   docker run -p 8080:8080 -v avgenx-data:/data avgenx-academy
# Put it behind HTTPS (a reverse proxy or your platform's TLS) and set TRUST_PROXY=true there.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production DB_PATH=/data/avgenx.db ACCOUNTS_XLSX=/data/accounts.xlsx PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/core ./src/core
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.mjs"]
