FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY bin ./bin
COPY src ./src
COPY public ./public
COPY integrations ./integrations
COPY scripts/build.mts ./scripts/build.mts
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY bin/tokenpet.mjs ./bin/tokenpet.mjs
RUN mkdir /data && chown node:node /data
USER node
ENV TOKENPET_DATA_DIR=/data TOKENPET_HOST=0.0.0.0 TOKENPET_PORT=4780 TOKENPET_WATCH=0 TOKENPET_PUBLIC_URL=http://localhost:4780
VOLUME /data
EXPOSE 4780
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "--input-type=module", "-e", "import http from 'node:http'; const r = http.get('http://127.0.0.1:' + process.env.TOKENPET_PORT + '/api/health', {headers: {Host: new URL(process.env.TOKENPET_PUBLIC_URL).host}}, res => {res.resume(); process.exitCode = res.statusCode === 200 ? 0 : 1;}); r.setTimeout(4000, () => r.destroy()); r.on('error', () => process.exitCode = 1);"]
CMD ["node", "bin/tokenpet.mjs", "server"]
