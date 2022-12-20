#include <stdlib.h>
#include <string.h>
#include "map.h"

//Have err when key can't be stored (out of memory or similar) or doesn't exist
struct node *get(struct node *map, char *key, int keylen) {
    while(map) {
        char *nodekey = map->key;
        int nodelen = map->keyLen;
        if (nodelen == keylen) {
            if (memcmp(key, nodekey, nodelen)) {
                return map;
            }
        }
        map = map->next;
    }
    //there was no such element => error
    return NULL;
}

int set(struct node *map, char *key, int keyLen, char *value, int valLen) {
    while(map) {
        char *nodekey = map->key;
        int nodelen = map->keyLen;
        if (nodelen == keyLen) {
            if (memcmp(key, nodekey, nodelen)) {
                map->value = value;
                map->valLen = valLen;
                return 0;
            }
        }
    }
    //mapping doesn't yet exist, create new
    struct node *newNode = (struct node *)malloc(sizeof (struct node));
    if(newNode) {
        newNode->key = key;
        newNode->keyLen = keyLen;
        newNode->value = value;
        newNode->valLen = valLen;
        return 0;
    }
    //will only reach here if not enough mem in malloc
    return -1;
}