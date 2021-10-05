#!/bin/bash

set -euo pipefail
export FORCE_COLOR=1
hardhat "$@" 2>&1 | `dirname $0`/solcErrors
