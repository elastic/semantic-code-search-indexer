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
