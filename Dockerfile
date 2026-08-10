FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime

ARG RAVENHILL_VERSION=0.1.1-dev
ARG RAVENHILL_REVISION=unknown
ARG RAVENHILL_SOURCE=https://github.com/d4rk22/ravenhill
LABEL org.opencontainers.image.title="Ravenhill dashboard" \
      org.opencontainers.image.description="Portable, read-only operations dashboard" \
      org.opencontainers.image.version="${RAVENHILL_VERSION}" \
      org.opencontainers.image.revision="${RAVENHILL_REVISION}" \
      org.opencontainers.image.source="${RAVENHILL_SOURCE}" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    RAVENHILL_CONFIG=/etc/ravenhill/ravenhill.yml
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && rm -f \
      node_modules/@fastify/send/test/fixtures/images/node-js.png \
      node_modules/@fastify/static/example/public/images/sample.jpg \
      node_modules/@fastify/static/test/content-type/sample.jpg \
      node_modules/@fastify/static/test/static-pre-compressed/sample.jpg \
      node_modules/@fastify/static/test/static/shallow/sample.jpg \
      node_modules/fastify/docs/resources/encapsulation_context.svg \
      node_modules/pino/favicon.ico \
      /usr/local/lib/node_modules/npm/node_modules/qrcode-terminal/example/basic.png \
    && npm cache clean --force \
    && rm -rf \
      /opt/yarn-v1.22.22 \
      /usr/local/lib/node_modules/corepack \
      /usr/local/lib/node_modules/npm \
      /tmp/node-compile-cache \
    && rm -f \
      /usr/local/bin/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg
COPY --from=build /app/dist ./dist
COPY public ./public
COPY fixtures ./fixtures
COPY ravenhill.example.yml /etc/ravenhill/ravenhill.yml
COPY LICENSE NOTICE /usr/share/licenses/ravenhill/
RUN install -d -o node -g node -m 0700 /var/lib/ravenhill
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
