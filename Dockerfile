# syntax=docker/dockerfile:1

FROM node:24-alpine
WORKDIR /app

LABEL org.opencontainers.image.title="gtfs-rt-metrics-service"
LABEL org.opencontainers.image.description="Consumes a GTFS Realtime (GTFS-RT) feed and serves metrics about it via HTTP."
LABEL org.opencontainers.image.authors="Verkehrsverbund Berlin Brandenburg <info@vbb.de>"

# install dependencies
RUN npm install --production

# add source code
ADD . /app

# CLI smoke test
RUN ./cli.js --help >/dev/null

ENTRYPOINT [ "./cli.js"]
