// This is a comment
import { a } from 'b';
import type { c } from 'd';

/**
 * This is a JSDoc comment.
 */
function hello() {
  console.log('Hello, world!');
}

export class MyClass {
  myMethod() {
    return 1;
  }
}

export const myVar = () => {};

export type MyType = {
  name: string;
};

export interface MyInterface {
  id: number;
}

export function myFunction() {
  return 42;
}

export default MyClass;
