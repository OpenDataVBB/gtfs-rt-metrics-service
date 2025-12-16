#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"
set -x

node trip-descriptors-match.js

# todo
