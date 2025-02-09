#!/bin/sh
name=geth-$$
trap "echo killing docker; docker kill $name 2> /dev/null" EXIT
docker run --name $name --rm -p 8545:8545 -p 54321:54321 dtr22/geth7702 $*
