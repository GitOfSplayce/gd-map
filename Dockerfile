# syntax=docker/dockerfile:1

# Image de la carte (D-003) : le site construit par Vite et le serveur Node (Hono) qui le sert avec
# l'API. Dokploy la construit et la déploie à chaque push sur main (D-008). Au démarrage : migrations,
# puis écoute sur 3600.

FROM node:26-alpine AS base
WORKDIR /app

# ---- Dépendances complètes, pour construire ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- Construction du site, et les tests ----
# Dokploy déploie à chaque push sur main (D-008) : un test qui échoue arrête la construction, et la
# version en ligne reste en place.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm test

# ---- Dépendances d'exécution seules ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Exécution ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3600
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
# Node exécute le serveur en .ts tel quel (types effacés, Node ≥ 22.18) : rien à compiler
COPY server ./server
COPY db/migrations ./db/migrations
COPY --from=builder /app/dist ./dist
RUN rm -f server/*.test.ts server/auth-schema.ts

USER node
EXPOSE 3600
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3600/api/health > /dev/null || exit 1

CMD ["node", "server/index.ts"]
