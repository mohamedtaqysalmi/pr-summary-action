# Keyless dry-run image. It does not call a model and does not post comments.
FROM node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vitest.config.mjs ./
COPY scripts ./scripts
COPY src ./src
COPY tests ./tests
RUN npm run build && npm test && npm run typecheck

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /src/dist ./dist
COPY --from=build /src/package.json ./package.json
COPY tests/fixtures ./fixtures
USER node
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["dry-run", "--diff-file", "fixtures/sample.diff", "--commits-file", "fixtures/commits.json", "--language", "en", "--mode", "full"]
