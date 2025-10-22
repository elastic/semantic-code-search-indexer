# Handlebars Language Parser Setup Notes

## Overview
This document describes the setup and configuration for the Handlebars language parser using tree-sitter-glimmer.

## Known Issue with tree-sitter-glimmer

The `tree-sitter-glimmer` package (v1.4.0) has a bug in its `binding.gyp` file where the external scanner (`src/scanner.c`) is not included in the build sources. This causes a runtime error:

```
Error: dlopen(...): symbol not found in flat namespace '_tree_sitter_glimmer_external_scanner_create'
```

### Workaround

If you encounter this error after installing the package, you need to manually fix the `binding.gyp` file:

1. Edit `node_modules/tree-sitter-glimmer/binding.gyp`
2. Add `"src/scanner.c"` to the sources array:

```gyp
"sources": [
  "bindings/node/binding.cc",
  "src/parser.c",
  "src/scanner.c",  // Add this line
  # NOTE: if your language has an external scanner, add it here.
],
```

3. Rebuild the package:
```bash
cd node_modules/tree-sitter-glimmer && npx node-gyp rebuild
```

### Future Resolution

This issue has been reported to the tree-sitter-glimmer maintainers. Once fixed in a future version, this workaround will no longer be necessary. Monitor the package releases and update when a fix is available.

## Parser Configuration

The Handlebars parser uses the following tree-sitter-glimmer node types:

- `block_statement` - Block helpers like `{{#if}}`, `{{#each}}`
- `mustache_statement` - Variable interpolation like `{{variable}}`
- `text_node` - Static text content
- `comment_statement` - Handlebars comments `{{! comment }}`
- `element_node` - HTML elements
- `helper_invocation` - Helper function calls

### Symbol Extraction

The parser extracts the following symbols:
- Variable references from `identifier` and `path_expression` nodes
- Helper/function calls from `helper_invocation` and `block_statement_start` nodes

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

