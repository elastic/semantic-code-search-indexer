# Chain of Investigation

## Description

This prompt helps you start a "chain of investigation" to understand a codebase and accomplish a task. It follows a structured workflow that leverages the available tools to explore the code, analyze its components, and formulate a plan.

## Workflow

The investigation process is flexible, but generally follows these steps. You can start with either a broad semantic search or a targeted symbol listing depending on the information you have.

### **Entry Point 1: Broad, Semantic Search**

1.  **Start with a high-level query using `semantic_code_search`:** This is best when you have a conceptual goal but don't know the specific files or symbols involved. For example, "user authentication flow" or "SLI registration logic."

2.  **Analyze results to identify key files:** The search will return relevant code chunks. From these, identify the most promising files or directories that seem central to your task.

3.  **Refine with `list_symbols_by_query` (Optional but Recommended):** Instead of reading entire files, use this tool to get a structured list of all symbols (classes, functions, etc.) within the key files you identified. This is often faster and gives you a clear overview of the file's purpose. For example: `kql: "filePath: (*auth/service.ts OR *auth/controller.ts)"`.

### **Entry Point 2: Targeted Symbol Listing**

1.  **Start with a targeted query using `list_symbols_by_query`:** This is the ideal starting point when the user's request points to a specific file, directory, or a concrete code artifact. For example, if the user asks, "What are all the exported functions in `src/utils`?", you can directly query it.

### **Continuing the Investigation**

4.  **Drill down with `symbol_analysis`:** From the symbol list (either from `semantic_code_search` or `list_symbols_by_query`), select the most relevant symbol. Use `symbol_analysis` to get a comprehensive, cross-referenced report of its definition, connections, and usages across the codebase.

5.  **Read the code with `read_file_from_chunks`:** With a strong understanding of the symbol's role and connections, use this tool to read its source code and understand the implementation details.

6.  **Formulate a plan:** Based on your analysis, create a step-by-step plan. This should include the files to modify, the specific changes required, and any tests that need to be added or updated.

7.  **Implement the changes:** Execute your plan using the available tools to modify code, add files, and run tests.

8.  **Verify your changes:** After implementation, verify that the changes work as expected by running the relevant tests or asking the user to confirm the outcome.