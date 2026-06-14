# syntax=docker/dockerfile:1

FROM node:24-trixie-slim
WORKDIR /app

LABEL org.opencontainers.image.title="gtfs-rt-metrics-service"
LABEL org.opencontainers.image.description="Consumes a GTFS Realtime (GTFS-RT) feed and serves metrics about it via HTTP."
LABEL org.opencontainers.image.authors="Verkehrsverbund Berlin Brandenburg <info@vbb.de>"

# curl is required for the health check
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt,sharing=locked \
	apt update && apt --no-install-recommends install -y curl

# install dependencies
ADD package.json /app
RUN \
	--mount=type=cache,target=/tmp/node-compile-cache \
	--mount=type=cache,target=/root/.npm \
	npm install --production

# add source code
ADD . /app

# CLI smoke test
RUN ./cli.js --help >/dev/null

ENV PORT=3000

EXPOSE $PORT

HEALTHCHECK --interval=10s --timeout=3s --start-interval=3s \
	CMD curl -fsS http://localhost:$PORT/health

ENTRYPOINT [ "./cli.js"]
