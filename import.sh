#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"

export GTFS_POSTPROCESSING_D_PATH="${GTFS_POSTPROCESSING_D_PATH:-"$PWD/gtfs-postprocessing.d"}"
export GTFS_DOWNLOAD_URL="${GTFS_DOWNLOAD_URL:-https://www.vbb.de/vbbgtfs}"
export GTFS_DOWNLOAD_USER_AGENT="${GTFS_DOWNLOAD_USER_AGENT:-OpenDataVBB/gtfs-rt-metrics-server GTFS import}"
export GTFS_IMPORTER_VERBOSE="${GTFS_IMPORTER_VERBOSE:-false}"
export GTFS_IMPORTER_DB_PREFIX="${GTFS_IMPORTER_DB_PREFIX:-gtfs}"
# The VBB GTFS feed usually doesn't need gtfstidy-ing.
export GTFSTIDY_BEFORE_IMPORT="${GTFSTIDY_BEFORE_IMPORT:-false}"

# if stdin is not a TTY, don't pass `-it`
docker_run_args=()
if [ -t 1 ]; then
	docker_run_args+=('-it')
fi

set -x

if [ "${1:-}" = '--docker' ]; then
	# run duckdb-gtfs-importer using Docker
	# todo: allow passing `--pull always`
	# todo: pin version
	docker run --rm "${docker_run_args[@]}" \
		-v "$PWD/gtfs":/var/gtfs \
		-v "$GTFS_POSTPROCESSING_D_PATH":/etc/gtfs/gtfs-postprocessing.d \
		-v /tmp/gtfs:/tmp/gtfs \
		-e GTFS_IMPORTER_VERBOSE \
		-e GTFS_DOWNLOAD_USER_AGENT \
		-e GTFS_POSTPROCESSING_D_PATH=/etc/gtfs/gtfs-postprocessing.d \
		-e GTFS_DOWNLOAD_URL \
		-e GTFSTIDY_BEFORE_IMPORT \
		-e GTFS_IMPORTER_DB_PREFIX \
		-e GTFSTIDY_BEFORE_IMPORT -e GTFSTIDY_FIX_ZIP -e GTFSTIDY_DEFAULT_ON_ERRS -e GTFSTIDY_DROP_ERRS -e GTFSTIDY_CHECK_NULL_COORDS -e GTFSTIDY_MIN_SHAPES -e GTFSTIDY_MINIMIZE_SERVICES -e GTFSTIDY_MINIMIZE_STOPTIMES -e GTFSTIDY_DELETE_ORPHANS -e GTFSTIDY_REMOVE_REDUNDANT_AGENCIES -e GTFSTIDY_REMOVE_REDUNDANT_ROUTES -e GTFSTIDY_REMOVE_REDUNDANT_SERVICES -e GTFSTIDY_REMOVE_REDUNDANT_SHAPES -e GTFSTIDY_REMOVE_REDUNDANT_STOPS -e GTFSTIDY_REMOVE_REDUNDANT_TRIPS \
		ghcr.io/opendatavbb/duckdb-gtfs-importer
else
	# run duckdb-gtfs-importer locally
	task \
		-t ./duckdb-gtfs-importer/Taskfile.yml \
		-d gtfs
fi
