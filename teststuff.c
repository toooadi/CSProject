#include <stdio.h>
#include <string.h>

int main() {
    char test[20];
    sprintf(test, "%d", 12879);
    printf("%s\n", test);
    printf("%d\n", (int) strlen(test));
    
}