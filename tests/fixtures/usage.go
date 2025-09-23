
package main

import "fmt"

func greet(name string) {
	fmt.Println("Hello,", name)
}

type Greeter struct{}

func (g Greeter) Greet(name string) {
	fmt.Println("Hello,", name)
}

func main() {
	greet("Go user")

	g := Greeter{}
	g.Greet("Go user")

	message := "Hello"
	anotherMessage := message
}
