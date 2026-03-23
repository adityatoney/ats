FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app

# Accept build-time env var for Convex URL
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=${VITE_CONVEX_URL}

# Copy all workspace files so pnpm resolves correctly
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

# Use hoisted node_modules layout for Docker compatibility
RUN echo "node-linker=hoisted" > .npmrc && \
    pnpm install --no-frozen-lockfile

# Copy source for shared + web
COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/

# Build shared first, then web (run vite from web directory)
RUN pnpm --filter @aegis/shared build && \
    cd packages/web && node /app/node_modules/vite/bin/vite.js build

# Serve with nginx (handles SPA routing + API proxy)
FROM nginx:alpine AS runtime
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
