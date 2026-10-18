# Build from repo root: docker build -f apps/hub-agent/Dockerfile -t devicenet/hub-agent .
FROM node:22-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @devicenet/shared build \
 && pnpm --filter @devicenet/web build:lan

FROM node:22-slim
ENV DN_DATA_DIR=/data
# default for compose: Mosquitto/Z2M run as sibling containers (override with DN_EXTERNAL_SERVICES=0)
ENV DN_EXTERNAL_SERVICES=1 DN_MQTT_HOST=mosquitto
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
VOLUME /data
EXPOSE 8080
CMD ["pnpm", "--filter", "@devicenet/hub-agent", "exec", "tsx", "src/main.ts"]
