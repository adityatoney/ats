FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./

# Copy only the packages needed by server
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/server/package.json packages/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/db/ packages/db/
COPY packages/server/ packages/server/

# Build shared and db first, then server
RUN pnpm --filter @aegis/shared build && \
    pnpm --filter @aegis/db build && \
    pnpm --filter @aegis/server build

EXPOSE 3001
CMD ["npx", "tsx", "packages/server/src/index.ts"]
