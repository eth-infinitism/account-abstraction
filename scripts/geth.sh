#!/bin/sh
name=geth-$$
trap "echo killing docker; docker kill $name 2> /dev/null" EXIT
port=$1
shift
params="--http --http.api eth,net,web3,debug --rpc.allow-unprotected-txs --allow-insecure-unlock --dev --http.addr 0.0.0.0"
docker run --name $name --rm -p $port:8545 ethpandaops/geth:master $params
