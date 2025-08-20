import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';

export const parsers: { [key: string]: any } = {
  '.ts': TypeScript.typescript,
  '.tsx': TypeScript.tsx,
  '.js': JavaScript,
  '.jsx': JavaScript,
  '.md': null,
  '.mdx': null,
};

export const SUPPORTED_FILE_EXTENSIONS = Object.keys(parsers);
