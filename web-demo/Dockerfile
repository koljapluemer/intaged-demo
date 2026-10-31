FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
ARG VITE_SYNC_URL
ENV VITE_SYNC_URL=$VITE_SYNC_URL
RUN npm run build

FROM build AS check
RUN npm run lint && npm test

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY package.json package-lock.json* ./
# widget-base holds the packages generated widgets import without an install at generation time.
COPY widget-base/package.json widget-base/package-lock.json ./widget-base/
RUN npm ci --omit=dev \
    && npm ci --prefix widget-base --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 3000 3030
CMD ["node", "dist-server/server/index.js"]
