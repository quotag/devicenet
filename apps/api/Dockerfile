# Cloud Run image. Build from repo root: docker build -f apps/api/Dockerfile -t devicenet/api .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @devicenet/api... \
 && pnpm --filter @devicenet/shared build \
 && pnpm --filter @devicenet/api build \
 && pnpm prune --prod

FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /repo
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/shared ./packages/shared
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /repo/package.json ./package.json

WORKDIR /repo/apps/api
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
