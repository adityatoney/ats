FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./

# Copy only the packages needed by server (no longer needs @aegis/db)
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/

# Copy convex directory (server imports convex/_generated/api)
COPY convex/ convex/

# Build shared then server
RUN pnpm --filter @aegis/shared build && \
    pnpm --filter @aegis/server build

EXPOSE 3001
CMD ["./packages/server/node_modules/.bin/tsx", "packages/server/src/index.ts"]
