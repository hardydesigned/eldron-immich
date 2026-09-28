# Offizielles immich-server-Image derselben Version, darin die gepatchte Web-Oberfläche und die SC-Anbindung.
# Build-Kontext ist die Repo-Wurzel (siehe docker-compose.yml).
ARG IMMICH_VERSION

FROM ghcr.io/immich-app/base-server-dev:202608300913@sha256:188679bfc2e7a496bdc13bd145cf59d90b2fb8f9dbf7131b2c1a368cd637b1a0 AS web
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  CI=1 \
  COREPACK_HOME=/tmp \
  PNPM_HOME=/buildcache/pnpm-store \
  PATH="/buildcache/pnpm-store:$PATH"
RUN npm install --global corepack@latest && \
  corepack enable pnpm && \
  pnpm config set store-dir "$PNPM_HOME"
WORKDIR /usr/src/app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY ./packages/sdk/package.json ./packages/sdk/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/sdk install --frozen-lockfile
COPY ./packages/sdk ./packages/sdk/
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/sdk build
COPY ./web/package.json ./web/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter immich-web install --frozen-lockfile
COPY ./i18n ./i18n/
COPY ./web ./web/
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter immich-web build

FROM ghcr.io/immich-app/immich-server:${IMMICH_VERSION}
ARG SOURCE_COMMIT
RUN apt-get update \
	&& apt-get install -y --no-install-recommends rclone fuse3 \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/src/app/web/build /build/www
COPY eldron/ffprobe-shim.sh /usr/local/bin/ffprobe
COPY eldron/mount-s3.sh /usr/local/bin/mount-s3.sh
COPY eldron/sc /sc
# AGPL: die Oberfläche verlinkt auf den Quelltext dieses Forks.
ENV IMMICH_REPOSITORY=hardydesigned/eldron-immich \
	IMMICH_REPOSITORY_URL=https://github.com/hardydesigned/eldron-immich \
	IMMICH_SOURCE_COMMIT=${SOURCE_COMMIT} \
	IMMICH_SOURCE_URL=https://github.com/hardydesigned/eldron-immich/commit/${SOURCE_COMMIT}
CMD ["/usr/local/bin/mount-s3.sh"]
