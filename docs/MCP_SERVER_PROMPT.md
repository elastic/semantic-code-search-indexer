I would like to create an MCP server based on modelcontextprotocol/sdk NPM package.

## Your task: Create an MCP Server

1.  **Setup an MCP Server** Create a new MCP server that runs on `stdio` using the `modelcontextprotocol/sdk`. I would also like a user to be able to run it using `npx` similar to other MCP servers you would find in the coding assistant ecosystem. I would also like to have a mode that will also server it via an API server that we could make a Docker image for (ease of use).

2.  **Create the three tools:**:
  - `semantic_code_search` which has the following features:
    - Accepts a semantic query string as an optional argument
    - Accepts a KQL query as an optional argument
    - Has pagination `page` and `size`
    - Queries the configured Elasticsearch instance using a `bool > must` query so the filter and query act as an `AND`
    - It return all the fields except `code_vector` or `semantic_text`
    - Return the results is the most useful format an LLM would expect
  - `list_symbols_by_query` which has the following features:
    - Accpets a KQL query
    - Uses the same aggregatoin as our `npm run search -- --aggregate-symbols <query>` command
    - Return the results is the most useful format an LLM would expect
  - `symbol_analysis` which has the following features:
    - Accepts a symbol name which can be queried via `content: "{sybmolName}"` KQL
    - Aggregates with a top level terms aggregation `filePath`, with sub aggregations for `kind` and `language`
    - Generate a report with the following categories:
      - Primary Definition(s): The file's `kind` is `function_declaration`, `class_declaration`, or `lexical_declaration`
      - Type Definition(s): The file's `kind` is `interface_declaration`, `type_alais_declaration`, or `enum_declaration`
      - Execution/Call Site(s): The file's `kind` is `call_expression`
      - Import Reference(s): The file's `kind` is `import_statement`
      - Documentation: The file is a markdown file or it's `kind` is `comment`
    - Each category lists the file, then all of it's `kind` values, and launguage

Focus on a clean, modular, and well-commented implementation. Create tests for each tool.

### Description for `semantic_code_search`

The primary tool for starting a "chain of investigation." Use this for broad, semantic exploration when you don't know the exact file or symbol names.

**Best for:**
*   **Initial Discovery:** Answering questions like, "Where is the logic for SLO SLIs?" or "How are API keys handled?"
*   **Finding Entry Points:** Use broad, conceptual queries (e.g., "SLI registration", "user authentication flow") to find the most relevant files and symbols.
*   **Narrowing the Search:** Once you have initial results, you can refine your search with more specific terms (e.g., "IndicatorType enum") or KQL filters.

**Workflow:**
1.  Start with a broad, semantic query to understand the landscape.
2.  Analyze the results to identify key files, functions, classes, or types.
3.  Once you have identified a specific, concrete symbol, **switch to `symbol_analysis`** for a precise analysis of its connections.

Either a `query` for semantic search or a `kql` filter is required. If both are provided, they are combined with a must clause (AND operator) in Elasticsearch. You can control the number of results with `size` and paginate through them using `page`.

You can use the following fields in your KQL queries:

- **type** (keyword): The type of the code chunk (e.g., 'code', 'doc').
- **language** (keyword): The programming language of the code (e.g., 'markdown', 'typescript', 'javascript').
- **kind** (keyword):  The specific kind of the code symbol (from LSP) (e.g., 'call_expression', 'import_statement', 'comment', 'function_declaration', 'type_alias_declaration', 'interface_declaration', 'lexical_declaration').
- **imports** (keyword): A list of imported modules or libraries.
- **containerPath** (text):  The path of the containing symbol (e.g., class name for a method).
- **filePath** (keyword): The absolute path to the source file.
- **startLine** (integer): The starting line number of the chunk in the file.
- **endLine** (integer): The ending line number of the chunk in the file.
- **created_at** (date): The timestamp when the document was created.
- **updated_at** (date): The timestamp when the document was last updated.

### IMPORTANT QUERY TIPS
- CRITICAL: ALWAYS use semantic search terms. If the user asks "Show me how to add an SLI to the SLO Plugin", use "add SLI to SLO plugin" for the query.
- CRITICAL: ALWAYS base your queries on the user's prompt, you will have a higher success rate by doing this.
- CRITICAL: ALWAYS follow the "chain of investigation" method
- CRITICAL: NEVER try to answer questions without using semantic search first.
- CRITICAL: NEVER double quite a `kql` wildcard query. Double quotes are used for EXACT MATCHES
- CRITICAL: ALWAYS show "I'm going to use `semantic_code_search` with the `query: "<insert-semantic-search-here>"` and `kql: "<kql-query-here>"` so the user can see what terms you're using to search
- If you are unsure what explicit values to use for `kind` use the `get_distinct_values` to get a complete list of the keywords
- If you are trying to match the exact name of a symbol, use the `content` field in a kql query like this: `content: "<symbol-name-here>"`

### Example: Semantic Search with a KQL Filter

To find all functions related to "rendering a table", you could use:


  {
    "query": "render a table",
    "kql": "kind: \"function_declaration\""
  }


### Example: KQL-Only Search

To find all TypeScript classes, omitting the semantic query, you could use:


  {
    "kql": "language: \"typescript\" and kind: \"class_declaration\"",
    "size": 5
  }


### Example: Paginated Search

To get the second page of 50 results for files importing the React library, you could use:


  {
    "query": "state management",
    "kql": "imports: *from 'react'*",
    "size": 50,
    "page": 2
  }


### Description for `list_symbols_by_query`

(Please provide a description that is similar to the other descriptions provided that would help an LLM, like yourself, understand how to use this tool most effectively.)

### Description for `symbol_analysis`

The precision tool for the second step in a "chain of investigation." Use this *after* `semantic_code_search` has helped you identify a specific, concrete symbol (e.g., a class name, function name, or type alias).

**Best for:**
*   **Drilling Down:** Answering the question, "Now that I've found `IndicatorType`, where is it actually used and how is it connected to the rest of the system?"
*   **Architectural Analysis:** The rich, categorized report helps you understand a symbol's role by showing you:
    *   Its definition.
    *   Where it is imported and used (call sites).
    *   How it's used in tests.
    *   Where it's referenced in documentation.
*   **Impact Analysis:** Quickly see all the places that would be affected by a change to the symbol.

**Workflow:**
1.  Use `semantic_code_search` or `list_symbols_by_query` tools to discover key symbols (e.g., `indicatorTypesSchema`).
2.  Feed that exact symbol name into `symbol_analysis` to get a comprehensive, cross-referenced report of all its connections.


