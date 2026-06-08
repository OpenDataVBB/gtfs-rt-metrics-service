#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"
set -x

brotli -d -k ../test/fixtures/*.gtfs.duckdb.br
