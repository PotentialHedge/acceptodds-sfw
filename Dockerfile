# Two targets from one build:
#
#   app    the Next.js standalone server (~200 MB). What runs behind Traefik.
#   tools  full dependencies + source, for the tsx scripts that are not part of
#          the server: migrations, token:mint, digest:send. Run one-off with
#          `docker compose run --rm tools npm run <script>`.

FROM node:26-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS tools
COPY . .
ENV NODE_ENV=production
CMD ["npm", "run", "db:migrate"]

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The cache mount keeps Next's compiler cache between builds: with one shared core
# the compile is nearly all of a deploy's time, and most modules do not change.
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:26-bookworm-slim AS app
# The commit this image was built from (docker-compose.prod.yml passes it): `docker inspect` shows it, and
# `GET /api/v1/version` reports it. The build context has no .git, so it can only come from the build.
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision=$GIT_COMMIT
WORKDIR /app
ENV GIT_COMMIT=$GIT_COMMIT \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Read at runtime from the working directory (INSTITUTION_DOMAINS_PATH overrides).
COPY --chown=node:node config ./config
# The share-card volume's mount point (docker-compose.prod.yml): a new named volume takes this
# directory's owner, so the app can write to it.
RUN mkdir /cards && chown node:node /cards
USER node
EXPOSE 3000
CMD ["node", "server.js"]
