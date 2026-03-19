import scala.collection.mutable.ListBuffer

// A simple trait
trait Greeter {
  def greet(name: String): String
}

// A simple class
class Person(val name: String, val age: Int)

// An object with a function
object HelloWorld extends Greeter {
  def greet(name: String): String = s"Hello, $name!"

  val greeting: String = "Welcome"
  var counter: Int = 0

  def main(args: Array[String]): Unit = {
    val people = ListBuffer[Person]()
    people += Person("Alice", 30)
    println(greet(people.head.name))
  }
}
