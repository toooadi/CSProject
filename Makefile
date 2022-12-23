CC = gcc 
ARGS = -Wall -pthread

CPPFLAGS+= -Wextra -Wfloat-equal -Wundef -Wcast-align -Wpedantic
CPPFLAGS+= -Wmissing-declarations -Wredundant-decls -Wshadow -Wwrite-strings
CPPFLAGS+= -Wno-unused-parameter
CPPFLAGS+= -g 

all:
	$(CC) $(ARGS) $(CPPFLAGS) server.c -o server && ./server
# the js script from discord
test:
	$(CC) $(ARGS) server.c -o server && (./server &) && node test.js -a && kill `pidof server`
# the test given
given:
	$(CC) $(ARGS) server.c -o server && (./server &) && ./runtest.sh && kill `pidof server`
# random spam from tons of clients
spam:
	curl https://transfer.sh/rCKKVm/perltry > perltry && \
	$(CC) $(ARGS) server.c -o server && (./server &) && perl perltry && kill `pidof server`
# checking if messages are correctly handled
small:
	curl https://transfer.sh/7rUUSd/pytests.py > pytests.py && \
	$(CC) $(ARGS) server.c -o server && (./server &) && python3 pytests.py -n 10 && kill `pidof server`
medium:
	curl https://transfer.sh/7rUUSd/pytests.py > pytests.py && \
	$(CC) $(ARGS) server.c -o server && (./server &) && python3 pytests.py -n 20 && kill `pidof server`
big:
	curl https://transfer.sh/7rUUSd/pytests.py > pytests.py && \
	$(CC) $(ARGS) server.c -o server && (./server &) && python3 pytests.py -n 100 && kill `pidof server`
lulz:
	curl https://transfer.sh/7rUUSd/pytests.py > pytests.py && \
	$(CC) $(ARGS) server.c -o server && (./server &) && python3 pytests.py -n 1000 && kill `pidof server`
# to check badstring for answer
check:
	curl https://transfer.sh/7rUUSd/pytests.py > pytests.py && \
	$(CC) $(ARGS) server.c -o server && (./server &) && python3 pytests.py -n 0 && kill `pidof server`
# check for progress under heavy malicious spammer load
godmode:
	curl https://transfer.sh/ztVTtk/pytestspammer.py > pytestspammer && \
	$(CC) $(ARGS) server.c -o server && (./server &) && python3 pytestspammer.py -n 1000 && kill `pidof server`
