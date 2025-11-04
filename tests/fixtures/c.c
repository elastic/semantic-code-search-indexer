#include <stdio.h>
#include <stdlib.h>
#include "header.h"

/* Function comment */
int add(int a, int b) {
    return a + b;
}

// Variable comment
int global_var = 10;

struct Point {
    int x;
    int y;
};

union Data {
    int i;
    float f;
    char c;
};

enum Color {
    RED,
    GREEN,
    BLUE
};

typedef struct Point Point_t;

/* Documented function */
void test_function() {
    int result = add(1, 2);
    printf("Result: %d\n", result);
}

static void private_function() {
    printf("Private\n");
}

int main(int argc, char *argv[]) {
    Point_t point = { .x = 10, .y = 20 };
    test_function();
    return 0;
}
