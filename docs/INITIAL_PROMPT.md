Please act as an expert software engineer and bootstrap a new TypeScript / Node.js project for me. The goal is to index a codebase and uses Elasticsearch for semantic search.

Your task is to generate the following:

1.  **Project Setup**: Create the necessary project structure, including a `package.json` with all required dependencies. This should include `@elastic/elasticsearch` for connecting to the database, a library like `typescript-eslint/parser` or a lightweight Tree-sitter wrapper for code parsing, and `dotenv` for environment variables.

2.  **Indexing Script**: Write a TypeScript script to handle the core indexing logic. This script should:
    * Use a library like Tree-sitter to parse source code files (e.g., `.ts`, `.js`, `.tsx`, `.jsx`).
    * Extract meaningful code chunks, such as entire functions, classes, and comments, along with their metadata (file path, line numbers, function name).
    * Use a local or hosted embedding model (or a placeholder for one) to generate vector embeddings for each code chunk.
    * Use the `@elastic/elasticsearch` client to store the chunks, their metadata, and their vector embeddings in an Elasticsearch index.
    * Include a function to handle both initial full indexing and subsequent incremental updates.

3.  **Configuration**: For the indexing script, allow the user to provide configuration via environment variables. For Elasticsearch: `ELASTICSEARCH_ENDPOINT`, `ELASTICSEARCH_USERNAME`, `ELASTICSEARCH_PASSWORD`, or if the user provides `ELASTICSEARCH_API_KEY`, then use that instead of the username and passwords.

4.  **Documentation**: Provide a README.md file that documents how to index the code, how to query Elasticsarch, how to setup the script, file layout, everything you'd expect from Github project to successfully run the indexer.

Focus on a clean, modular, and well-commented implementation. Prioritize clarity over production-readiness, but ensure the code is functional and demonstrates the core concepts.
