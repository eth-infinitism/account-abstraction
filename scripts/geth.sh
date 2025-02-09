#!/bin/sh -xe
name=geth-$$
trap "echo killing docker; docker kill $name 2> /dev/null" EXIT
port=$1
shift
docker run --name $name --rm -p $port:8545 dtr22/geth7702 $*
