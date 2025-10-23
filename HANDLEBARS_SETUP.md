# Handlebars Language Parser Setup Notes

## Overview
This document describes the setup and configuration for the Handlebars language parser.

## Parser Implementation

The Handlebars parser uses a **custom parser** approach (similar to Markdown, YAML, and JSON) rather than tree-sitter. This decision was made because:

1. The `tree-sitter-glimmer` package has a bug in its `binding.gyp` that prevents it from building correctly
2. Maintaining a fork of the package is not desirable
3. Template files benefit from whole-file indexing rather than granular AST-based chunking

## Parser Behavior

The Handlebars parser treats each template file as a single chunk:

- **One chunk per file** - The entire template is indexed as a single unit
- **Preserves full context** - All static content and Handlebars expressions are kept together
- **Simple and reliable** - No external dependencies or native compilation required
- **Consistent with other document types** - Follows the same pattern as Markdown and YAML

## Testing

Run tests with:
```bash
npm test -- tests/parser.test.ts
npm test -- tests/languages.test.ts
```

## Example Usage

```typescript
const parser = new LanguageParser();
const result = parser.parseFile('template.hbs', 'main', 'path/to/template.hbs');
console.log(`Created ${result.chunks.length} chunks`);
console.log(`Extracted ${result.chunks.flatMap(c => c.symbols || []).length} symbols`);
```

