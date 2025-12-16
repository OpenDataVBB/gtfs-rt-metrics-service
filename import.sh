#!/bin/sh

set -eu -o pipefail

# todo: make these customisable
export GTFS_IMPORTER_VERBOSE=false

set -x

# todo: pin version
docker run \
	--rm -it \
	-v $PWD/gtfs:/var/gtfs \
	-v $PWD/gtfs-postprocessing.d:/etc/gtfs/gtfs-postprocessing.d \
	-v /tmp/gtfs:/tmp/gtfs \
	-e GTFS_IMPORTER_VERBOSE \
	-e GTFS_DOWNLOAD_USER_AGENT \
	-e GTFS_POSTPROCESSING_D_PATH=/etc/gtfs/gtfs-postprocessing.d \
	-e GTFS_DOWNLOAD_URL \
	-e GTFSTIDY_BEFORE_IMPORT \
	-e GTFS_IMPORTER_DB_PREFIX \
	ghcr.io/opendatavbb/duckdb-gtfs-importer
