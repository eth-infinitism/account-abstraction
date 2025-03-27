#!/bin/bash -xe
#echo prepack for "contracts" package

cd $(dirname $0)/..
pwd

if git status contracts | grep -v 'nothing to commit' | grep -q Untracked; then
  exit 1
fi

yarn clean
yarn compile

cd contracts

rm -rf artifacts

mkdir -p artifacts

find ../artifacts/contracts -type f | grep -v -E 'test|Test|dbg|bls|IOracle|v06' | while IFS= read -r file; do
  cp "$file" artifacts/
done
