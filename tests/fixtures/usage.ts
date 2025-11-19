function sayHello(name: string) {
  console.log(`Hello, ${name}`);
}

sayHello('World');

class MyClass {
  constructor() {
    console.log('MyClass instantiated');
  }
}

const instance = new MyClass();

const myVar = 'value';
const anotherVar = myVar;
