#include <stddef.h>
#include <stdio.h>
#include <errno.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <pthread.h>
#include <string.h>
#include <poll.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>

/*  
*   FIRST PART:
*       MAP IMPLEMENTATION
*/
struct node
{
char *key;  //key part
int keyLen;
char *value;  // value part
int valLen;
struct node *next;
};

//Have err when key can't be stored (out of memory or similar) or doesn't exist
struct node *get(struct node *map, char *key, int keylen) {
    while(map) {
        char *nodekey = map->key;
        int nodelen = map->keyLen;
        if (nodelen == keylen) {
            if (!memcmp(key, nodekey, nodelen)) {
                return map;
            }
        }
        map = map->next;
    }
    //there was no such element => error
    return NULL;
}

int set(struct node **map, char *key, int keyLen, char *value, int valLen) {
    struct node *prev = NULL;
    struct node *curr = *map;
    while(curr) {
        char *nodekey = curr->key;
        int nodelen = curr->keyLen;
        if (nodelen == keyLen) {
            if (!memcmp(key, nodekey, nodelen)) {
                //printf("here2: %.*s\n", keyLen, nodekey);
                curr->value = memcpy(malloc(valLen), value, valLen);
                curr->valLen = valLen;
                return 0;
            }
        }
        prev = curr;
        curr = curr->next;
    }
    //mapping doesn't yet exist, create new
    struct node *newNode = (struct node *)malloc(sizeof (struct node));
    if(newNode) {
        if (!(*map)) *map = newNode; //set map to first node
        if (prev) prev->next = newNode;
        newNode->key = memcpy(malloc(keyLen), key, keyLen);
        newNode->keyLen = keyLen;
        newNode->value = memcpy(malloc(valLen), value, valLen);
        newNode->valLen = valLen;
        newNode->next = NULL;
        return 0;
    }
    //will only reach here if not enough mem in malloc
    return -1;
}

/*
*   SECOND PART:
*       SERVER IMPLEMENTATION
*/

typedef struct{
    int sock;
    struct sockaddr address;
    int addr_len;
}connection_t;

typedef struct node node;

node *map = NULL;
pthread_mutex_t map_mutex;

//this is the functionality of the thread, hopefully this is right
/* The thread should:
    -check if the input is valid, if not send 'ERR\n'
    -if correct, read the input
    -perform the correct action requested by the input
    -return the correct value based on the action
*/
int find_strlen(int sock) {
    char fst;
    char *str = "";
    //The if checks if there was an error in the read
    if (read(sock, &fst, sizeof(char)) <= 0) return -1;
    int i = 0;
    while (fst != '$') {
        //greater than max possible size
        if (++i > 7) {free(str); return -1;}

        size_t len = strlen(str);
        char *strc = malloc(len + 1 + 1);
        strcpy(strc, str);
        if (strlen(str)) free(str); //only free the malloced memory if it isn't ""
        strc[len] = fst;
        strc[len + 1] = '\0';
        str = strc;
        if (read(sock, &fst, sizeof(char)) <= 0) {free(str); return -1;}
    }
    //return -1 if we have $$
    if (i == 0) {return -1;
    } else {
        int res = atoi(str);
        free(str);
        return (res > 4194304) || (res <= 0) ? -1 : res; //check for max size or negative value
    }

}

int read_str(connection_t *conn, char **buffer, int *len) {
    char fst;
    //Also check here whether read returns an error value, <= because this would be invalid input
    if (read(conn->sock, &fst, 1) <= 0) return -1;
    //check if first char is '$' which it has to be
    if (fst == '$') {
        int strlen = find_strlen(conn->sock);
        if (strlen < 0) return -1;
        *len = strlen;
        //Right now, the file pointer should be at the first char of the key/value
        *buffer = (char *)malloc(strlen * sizeof(char));
        //out of memory
        if (!buffer) return -1;
        //maybe check < strlen and throw error then
        if (read(conn->sock, *buffer, strlen) < strlen) {printf("read less than expected. \n"); free(*buffer); return -1;}

        return 0;
    } else return -1;
}

/*Return value:
    0 if GET
    1 if SET
    -1 on error*/
int read_opr(connection_t *conn) {
    char *buf = (char *)malloc(4 * sizeof(char));
    buf[3] = '\0';
    //check for negative and 0 because 0 means EOF => invalid input
    if (read(conn->sock, buf, 3) <= 0) return -1;
    char *get = "GET";
    char *set = "SET";
    if (!strcmp(buf, get)) {
        free(buf);
        return 0;
    } else if (!strcmp(buf, set)) {
        free(buf);
        return 1;
    } else {
        free(buf);
        return -1;
    }
}

/*Function to tell if the last char of a command was \n
    returns -1 on failure, 0 otherwise */
int consume_newline(connection_t *conn) {
    char nl;
    if (read(conn->sock, &nl, 1) <= 0) return -1;
    return nl == '\n' ? 0 : 1;
}

void misbehaviour(connection_t *conn) {
    //Here we basically only have to close the connection and kill the thread
    close(conn->sock);
    free(conn);
    pthread_exit(0);
}

//need this function declaration to call process in waitAndPoll
void *process(void *ptr);
/*This is called as soon as we have finished one request and wait for the next
If a new request arrives, we enter process again.
process() call has to be in the return statement so we don't waste stack space*/
void *waitAndPoll(connection_t *conn) {
    //poll(...) usage: struct pollfd -> basically array of file descriptors, 
    //                 nfds -> # of fds, timeout -> time to block waiting for fd
    while (1) {
        //calloc is important, as we set flags
        struct pollfd *pfd = calloc(1, sizeof(struct pollfd));
        pfd->fd = conn->sock;
        pfd->events = POLLIN;
        poll(pfd, 1, 1000);
        if (pfd->revents & POLLIN) {
            free(pfd);
            return process(conn);
        } else if (pfd->revents & POLLHUP) {
            close(conn->sock);
            free(pfd);
            pthread_exit(0);
            return NULL;
        }
    }
    return NULL;
}

/* We want the socket to be non-blocking since we might block indefinitely otherwise
*  Returns: -1 on failure
            0 on success */
int setnonblock(int sock) {
   int flags;
   flags = fcntl(sock, F_GETFL, 0);
   if (-1 == flags)
      return -1;
   return fcntl(sock, F_SETFL, flags | O_NONBLOCK);
}

void *process(void *ptr) {
    connection_t *conn;

    //connection is NULL
    if (!ptr) pthread_exit(0);
    conn = (connection_t *)ptr;

    //First, check whether first three chars are GET or SET
    int opr = read_opr(conn);
    if (opr == 0) {
        //GET Case, we have GET[str]\n
        int keyLen;
        char *buf;
        if (read_str(conn, &buf, &keyLen) < 0) misbehaviour(conn); 
        if (consume_newline(conn) < 0) {free(buf); misbehaviour(conn);}

        //If we're here, we know that we have a correct request
        pthread_mutex_lock(&map_mutex);
        node *getVal = get(map, buf, keyLen);
        pthread_mutex_unlock(&map_mutex);
        if (!getVal) {
            if (write(conn->sock, "ERR\n", 4) <= 0) {/*Maybe TODO: Handle error*/};
            free(buf);
            return waitAndPoll(conn);
        }
        int valLen = getVal->valLen;
        char *val = getVal->value;
        char intStr[8];
        sprintf(intStr, "$%d$", valLen);
        int intStrLen = strlen(intStr);
        char vs[intStrLen + 5];
        sprintf(vs, "VALUE");
        char *resp = strcat(vs, intStr);
        if (write(conn->sock, resp, 5 + intStrLen) <= 0) {/*Maybe TODO: Handle error*/};
        if (write(conn->sock, val, valLen) <= 0) {/*Maybe TODO: Handle error*/};
        if (write(conn->sock, "\n", 1) <= 0) {/*Maybe TODO: Handle error*/};

        free(buf);

        return waitAndPoll(conn);

    } else if (opr == 1) {
        //printf("In SET\n");
        //SET Case, we have SET[str]\n
        int keyLen;
        char *keyBuf;
        int valLen;
        char *valBuf;
        if (read_str(conn, &keyBuf, &keyLen) < 0 || read_str(conn, &valBuf, &valLen) < 0){
            misbehaviour(conn); //invalid request
        } 
        if (consume_newline(conn) < 0) {free(keyBuf); free(valBuf); misbehaviour(conn);} //invalid request

        //If we're here, we know that we have a valid request
        pthread_mutex_lock(&map_mutex);
        int stored = set(&map, keyBuf, keyLen, valBuf, valLen);
        pthread_mutex_unlock(&map_mutex);
        if (stored < 0) {
            if (write(conn->sock, "ERR\n", 4) <= 0) {/*Maybe TODO: Handle error*/};
            free(keyBuf); free(valBuf);

            return waitAndPoll(conn);

        } else {
            //Success
            if (write(conn->sock, "OK\n", 3) <= 0) {/*Maybe TODO: Handle error*/};
            free(keyBuf); free(valBuf);
            return waitAndPoll(conn);
        }

    } else { //invalid request: Command was neither GET nor SET
        //printf("In ERROR\n");
        misbehaviour(conn);
        return NULL;
    }
    
}

int main() {
    int sock = -1;
    struct sockaddr_in address;
    u_int16_t port = 5555;
    connection_t *connection;
    pthread_t thread;

    sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock <= 0) {
        fprintf(stderr, "Error: Cannot create socket.\n");
        return -1;
    }
    address.sin_family = AF_INET;

    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(port);

    //bind socket to port
    if (bind(sock, (struct sockaddr *)&address, sizeof(struct sockaddr_in)) < 0) {
        fprintf(stderr, "error: cannot bind socket to port %d\n",  port);
        return -5;
    }

    if (listen(sock, 5) < 0) {
        fprintf(stderr, "Cannot listen on port");
        return -5;
    }
    printf("ready and listening on port %d\n", ntohs(address.sin_port));

    while(1) {
        connection = (connection_t *)malloc(sizeof(connection_t));
        connection->sock = accept(sock, &(connection->address), &(connection->addr_len));
        //connection->sock = accept(sock, NULL, NULL);
        if (connection->sock <= 0) {
            free(connection);
        } else {
            //IMPORTANT: Set socket nonblocking
            if (setnonblock(connection->sock) < 0) printf("Couldn't set socket nonblocking.\n");
            pthread_create(&thread, 0, process, (void *)connection);
            pthread_detach(thread);
        }

    }
    return 0;

}