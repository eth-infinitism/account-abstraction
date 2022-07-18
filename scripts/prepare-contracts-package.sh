#!/bin/bash -e
#echo prepack for "contracts" package

pwd
cd `dirname $0`/../contracts

if git status .|grep -v 'nothing to commit'|tee /dev/stderr |grep -q Untracked; then
 exit 1
fi


rm -rf artifacts typechain

mkdir -p artifacts
#cp `find  ../artifacts/ -not -name '*Test*' -not -name '*dbg*' -name '*.json'` artifacts/
cp `find  ../artifacts/contracts -type f -not -name '*dbg*' -name '*.json'` artifacts/
cp -r ../typechain .
