
# Chain of Investigation

## Description

This prompt helps you start a "chain of investigation" to understand a codebase and accomplish a task. It follows a structured workflow that leverages the available tools to explore the code, analyze its components, and formulate a plan.

## Workflow

1.  **Start with a broad, semantic query:** Use the `semantic_code_search` tool to get a high-level overview of the codebase. For example, if you want to add a new feature, you can search for the main components related to that feature.

2.  **Analyze the results:** The `semantic_code_search` tool will return a list of code chunks that are relevant to your query. Analyze these results to identify key files, functions, classes, or types.

3.  **Drill down with `symbol_analysis`:** Once you have identified a specific symbol, use the `symbol_analysis` tool to get a comprehensive, cross-referenced report of all its connections. This will help you understand the symbol's role in the system and its dependencies.

4.  **Read the code with `read_file_from_chunks`:** After you have a good understanding of the symbol's connections, you can use the `read_file_from_chunks` tool to read the relevant code and get a deeper understanding of its implementation.

5.  **Formulate a plan:** Based on your analysis, you can now formulate a plan to accomplish your task. This plan should include the files you need to modify, the changes you need to make, and the tests you need to add.

6.  **Implement the changes:** Once you have a plan, you can start implementing the changes. Use the available tools to modify the code, add new files, and run tests.

7.  **Verify your changes:** After you have implemented the changes, you need to verify that they work as expected. Run available tests OR ask the user to verify it manually to ensure you've completed the task.
