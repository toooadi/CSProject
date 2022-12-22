#!/bin/bash

echo "===== Running multi test ====="

run_client () {
  echo "Running client $1"
  RES=$(nc -w 1 localhost 5555 < "$1.client")
  diff <(echo "$RES") "$1.client.out"
#  nc -w 1 localhost 5555 < "$1.client" > "$1.client.out"
  if (($? == 0)); then
        echo "Client $1: Successful!"
    else
        echo "Client $1: Error! <========="
        echo $RES
        exit 1
    fi
}

for client in 0 1 2 3 4; do
  run_client $client &
done

