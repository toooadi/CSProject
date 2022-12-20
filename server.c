#include <stddef.h>
#include <stdio.h>
#include <errno.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <pthread.h>
#include <linux/in.h>
#include <string.h>
#include "map.h"

typedef struct{
    int sock;
    struct sockaddr address;
    int addr_len;
}connection_t;

typedef struct node node;

node *map = NULL;
pthread_mutex_t map_mutex;
//max length in Bytes is 4194304 (i.e. cannot have more than 7 digits)

//this is the functionality of the thread, hopefully this is right
/* The thread should:
    -check if the input is valid, if not send 'ERR\n'
    -if correct, read the input
    -perform the correct action requested by the input
    -return the correct value based on the action
*/
int find_strlen(int sock) {
    char fst;
    char *str;
    //The if checks if there was an error in the read
    if (read(sock, &fst, sizeof(char)) <= 0) return -1;
    int i = 0;
    while (fst != '$') {
        //greater than max possible size
        if (++i > 7) return -1;

        size_t len = strlen(str);
        char *strc = malloc(len + 1 + 1);
        strcpy(strc, str);
        strc[len] = fst;
        strc[len + 1] = '\0';
        str = strc;
        if (read(sock, &fst, sizeof(char)) <= 0) return -1;
    }
    //return -1 if we have $$
    return i == 0 ? -1 : atoi(str);

}

int read_str(connection_t *conn, char *buffer, int *len) {
    char fst;
    //Also check here whether read returns an error value, <= because this would be invalid input
    if (read(conn->sock, &fst, 1) <= 0) return -1;
    //check if first char is '$' which it has to be
    if (fst == '$') {
        int strlen = find_strlen(conn->sock);
        if (strlen < 0) return -1;
        *len = strlen;
        //Right now, the file pointer should be at the first char of the key/value
        //TODO: Check out of memory
        buffer = (char *)malloc(strlen * sizeof(char));
        //maybe check < strlen and throw error then
        if (read(conn->sock, buffer, strlen) <= 0) return -1;

        return 0;
    } else return -1;
}

/*Return value:
    0 if GET
    1 if SET
    -1 on error
*/
int read_opr(connection_t *conn) {
    char *buf = (char *)malloc(4 * sizeof(char));
    buf[3] = '\0';
    //check for negative and 0 because 0 means EOF => invalid input
    if (read(conn->sock, buf, 3) <= 0) return -1;
    char *get = "GET";
    char *set = "SET";
    if (strcmp(buf, get)) {
        return 0;
    } else if (strcmp(buf, set)) {
        return 1;
    } else {
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

void *process(void *ptr) {
    //TODO: Handle closing and reopening
    connection_t *conn;
    long addr = 0;

    //connection is NULL
    if (!ptr) pthread_exit(0);
    conn = (connection_t *)ptr;
    //client IP
    addr = (long)((struct sockaddr_in *)&conn->address)->sin_addr.s_addr;

    //First, check whether first three chars are GET or SET
    int opr = read_opr(conn);
    if (opr == 0) {
        //GET Case, we have GET[str]\n
        int keyLen;
        char *buf;
        if (read_str(conn, buf, &keyLen) < 0) misbehaviour(conn); 
        if (consume_newline(conn) < 0) misbehaviour(conn);

        //If we're here, we know that we have a correct request
        pthread_mutex_lock(&map_mutex);
        node *getVal = get(map, buf, keyLen);
        pthread_mutex_unlock(&map_mutex);
        if (!getVal) {/*TODO: ERR Handle*/}
        
        int valLen = getVal->valLen;
        char *val = getVal->value;
        char *intStr;
        //char *resp = "VALUE";
        sprintf(intStr, "$%d$", valLen);
        int intStrLen = strlen(intStr);
        char *resp = strcat("VALUE", intStr);
        if (write(conn->sock, resp, 5 + intStrLen) <= 0) {/*Maybe TODO: Handle error*/};
        if (write(conn->sock, val, valLen) <= 0) {/*Maybe TODO: Handle error*/};
        if (write(conn->sock, "\n", 1) <= 0) {/*Maybe TODO: Handle error*/};

        //TODO: Response was sent, wait for next request

    } else if (opr == 1) {
        //SET Case, we have SET[str]\n
        int keyLen;
        char *keyBuf;
        int valLen;
        char *valBuf;
        if (read_str(conn, keyBuf, &keyLen) < 0 || read_str(conn, valBuf, &valLen) < 0){
            misbehaviour(conn); //invalid request
        } 
        if (consume_newline(conn) < 0) misbehaviour(conn); //invalid request

        //If we're here, we know that we have a valid request
        pthread_mutex_lock(&map_mutex);
        int stored = set(map, keyBuf, keyLen, valBuf, valLen);
        pthread_mutex_unlock(&map_mutex);
        if (stored < 0) {
            /*Send ERR, out of mem*/
        } else { //Maybe can remove else, implementation dependent
            //Success
            if (write(conn->sock, "OK\n", 3) <= 0) {/*Maybe TODO: Handle error*/};

            //TODO: Response was sent, wait for next request
        }

    } else { //invalid request: Command was neither GET nor SET
        misbehaviour(conn);
    }
    
}
