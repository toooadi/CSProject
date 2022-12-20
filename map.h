#include <stdlib.h>
#include <string.h>

struct node
{
char *key;  //key part
int keyLen;
char *value;  // value part
int valLen;
struct node *next;
};
struct node *get(struct node *map, char *key, int keylen);
int set(struct node *map, char *key, int keyLen, char *value, int valLen);