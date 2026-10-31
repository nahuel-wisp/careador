# syntax=docker/dockerfile:1

# ---------- build: instala todo y compila web + servidor ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/devices/package.json packages/devices/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- deps: sólo los módulos que quedan fuera del bundle ----------
# El servidor se empaqueta con esbuild; en runtime sólo hacen falta los "external" de build.mjs,
# en las mismas versiones del package-lock.
FROM node:22-bookworm-slim AS deps
WORKDIR /rt
COPY package-lock.json /tmp/
RUN node -e "const l=require('/tmp/package-lock.json').packages; \
  const v=n=>l['node_modules/'+n].version; \
  require('fs').writeFileSync('package.json', JSON.stringify({private:true, dependencies:{ \
    'better-sqlite3': v('better-sqlite3'), '@fastify/static': v('@fastify/static') }}))" \
 && npm install --omit=dev --no-audit --no-fund

# ---------- runtime ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TZ=America/Argentina/Buenos_Aires
WORKDIR /app/apps/server

COPY --from=deps /rt/node_modules /app/node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist /app/apps/web/dist

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
