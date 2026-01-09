#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"
set -x

brotli -d -k fixtures/*.gtfs.duckdb.br

node trip-descriptors-match.js
node matching.js

# todo
