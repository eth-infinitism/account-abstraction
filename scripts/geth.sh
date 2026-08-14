#!/bin/sh
name=geth-$$
trap "echo killing docker; docker kill $name 2> /dev/null" EXIT
port=$1
shift
docker run --name $name --rm -p $port:8545 ethpandaops/geth:master \
  --http --http.api eth,net,web3,debug --rpc.allow-unprotected-txs --dev --http.addr 0.0.0.0 \
  --http.corsdomain '*' --http.vhosts '*'
