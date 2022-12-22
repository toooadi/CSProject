#!/bin/bash

TEST_NAME="$1"
if [ -z "$TEST_NAME" ]
  then
    echo "No argument supplied, please provide a test to run"
    exit 2
fi

N_TESTS_RAN=0
N_TESTS_SUCCESSFUL=0
for cur_test_name in "basic" "longkey" "longvalue" "crazystring"; do
  if [[ "$TEST_NAME" == "$cur_test_name" ]]; then

    echo "===== Running test $cur_test_name ====="

    TEST_IN="test_$cur_test_name.in"
    TEST_OUT="test_$cur_test_name.out"

    # Note: Depending on your version of netcat, you might have to adapt the timeout parameter so netcat
    # terminates the connection after sending the input.
    nc -w 1 localhost 5555 < $TEST_IN | diff - $TEST_OUT

    if (($? == 0)); then
        echo "Test successful!"
        N_TESTS_SUCCESSFUL=$((N_TESTS_SUCCESSFUL+1))
    else
        echo "Error!"
        echo "> Did you restart the server?"
        exit 1
    fi
    N_TESTS_RAN=$((N_TESTS_RAN+1))
    break
  fi
done

if [[ $N_TESTS_RAN == 0 ]]; then
  echo "Test $TEST_NAME not found!"
  exit 2
fi

echo "Finished tests: $N_TESTS_SUCCESSFUL/$N_TESTS_RAN successful."
echo "> Don't forget to restart your server before running the next test!"

