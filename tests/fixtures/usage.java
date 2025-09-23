
class Greeter {
    public static void main(String[] args) {
        System.out.println("Hello, Java!");
    }

    public void greet(String name) {
        System.out.println("Hello, " + name);
    }
}

class Main {
    public static void main(String[] args) {
        Greeter greeter = new Greeter();
        greeter.greet("Java user");

        String message = "Hello";
        String anotherMessage = message;
    }
}
