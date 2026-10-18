# Cloud Run image. Build from repo root: docker build -f apps/api/Dockerfile -t devicenet/api .
# api has no emit step (tsc --noEmit), so it runs through tsx like hub-agent. Cloud Run injects PORT.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @devicenet/api... \
 && pnpm --filter @devicenet/shared build

FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
USER node
EXPOSE 8080
CMD ["pnpm", "--filter", "@devicenet/api", "exec", "tsx", "src/main.ts"]
