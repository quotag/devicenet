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
 && pnpm --filter=@devicenet/api deploy --legacy --prod /out \
 && cp -r apps/api/dist /out/dist

FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./

USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
