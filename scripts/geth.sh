#!/bin/sh
trap "echo killing docker; docker kill geth-7702-23" EXIT
docker run --name geth-7702-23 --rm -p 8545:8545 -p 54321:54321 dtr22/geth-7702-23 $*
