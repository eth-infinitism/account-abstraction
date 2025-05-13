#!/bin/sh
name=geth-$$
trap "echo killing docker; docker kill $name 2> /dev/null" EXIT
port=$1
shift
params="--http --http.api eth,net,web3,debug --rpc.allow-unprotected-txs --allow-insecure-unlock --dev --http.addr 0.0.0.0"

# Esperar um momento para garantir que qualquer processo anterior tenha terminado
sleep 2

# Verificar se o Docker está em execução
if ! docker info > /dev/null 2>&1; then
  echo "Docker is not running. Starting tests without Geth."
  exit 0
fi

docker run --name $name --rm -p $port:8545 ethpandaops/geth:master $params
