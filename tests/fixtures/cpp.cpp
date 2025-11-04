#include <iostream>
#include <vector>
#include "myheader.hpp"

namespace MyNamespace {
    /* Class documentation */
    class MyClass {
    public:
        MyClass();
        ~MyClass();
        
        // Method documentation
        void publicMethod();
        
        template<typename T>
        T templateMethod(T value) {
            return value;
        }
        
    private:
        int privateField;
        void privateMethod();
    };
    
    // Struct documentation
    struct Point {
        int x;
        int y;
        
        Point(int x, int y) : x(x), y(y) {}
    };
    
    // Enum documentation
    enum class Color {
        RED,
        GREEN,
        BLUE
    };
    
    // Function documentation
    template<typename T>
    T add(T a, T b) {
        return a + b;
    }
    
    // Variable documentation
    const int CONSTANT = 42;
    
    // Typedef documentation
    typedef std::vector<int> IntVector;
    
    // Using declaration
    using String = std::string;
}

// Function with namespace
void MyNamespace::MyClass::publicMethod() {
    std::cout << "Hello" << std::endl;
}

int main(int argc, char* argv[]) {
    MyNamespace::MyClass obj;
    obj.publicMethod();
    
    MyNamespace::Point p(10, 20);
    int result = MyNamespace::add(1, 2);
    
    return 0;
}
