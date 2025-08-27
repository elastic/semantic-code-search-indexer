<style>section { font-size: 20px; }</style>
# The Challenge of Code Complexity

## Understanding large, complex codebases is a significant challenge.

-   **Onboarding:** New engineers face a steep learning curve.
-   **Collaboration:** It's difficult to work on code you didn't write.
-   **Discovery:** Finding specific examples or implementations can be like searching for a needle in a haystack.

Traditional search tools often fall short because they rely on keywords, not intent.

---

# Solution: The AI Code Indexer

## Turning your codebase into an intelligent, searchable knowledge base.

By combining intelligent code parsing with the power of **Elastic's Learned Sparse Encoder (ELSER)**, we create a rich, semantic index of your code.

This allows developers and AI agents to ask questions in natural language and get back conceptually relevant results, not just keyword matches.

---

# How Indexing Works: From Code to Concepts

Our indexing process is designed to capture the semantic meaning of your code.

1.  **Parsing with Tree-Sitter:** We use `tree-sitter` to parse source code into a concrete syntax tree. This allows us to understand the structure and identify distinct, meaningful chunks like functions, classes, and interfaces.

2.  **Intelligent Chunking:**
    *   **Code:** We don't just split files. We create documents for each logical block of code (e.g., `function`, `class`, `method`). This preserves the local context.
    *   **Markdown:** Documentation files (`.md`) are split into sections based on their headings, keeping related paragraphs together.

3.  **Enrichment & Embedding:** Each chunk is enriched with metadata and then processed by ELSER to create a `sparse_vector` embedding of its content.

---

# Example of a Code Chunk Embedding

Each embedding is created with additional context to help with relevence, the chunk bellow shoud match "a function that flattens an object".

```
filePath: src/platform/packages/shared/kbn-std/src/get_flattened_object.ts
kind: function_declaration

function getFlattenedObject(rootValue: Record<string, any>) {
    if (!shouldReadKeys(rootValue)) {
     throw new TypeError(`Root value is not flatten-able, received ${rootValue}`);
     }
     const result: { [key: string]: any } = {};
     (function flatten(prefix, object) {
        for (const [key, value] of Object.entries(object)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (shouldReadKeys(value)) {
                flatten(path, value);
            } else {
                 result[path] = value;
            }
        }
    })('', rootValue);
    return result;
}
```

---

# The "Code Chunk" Schema

Each document in our index represents a single chunk of code or documentation, structured for powerful queries.

```json
{
  "mappings": {
    "properties": {
      "type": { "type": "keyword" },
      "language": { "type": "keyword" },
      "kind": { "type": "keyword" },
      "imports": { "type": "keyword" },
      "containerPath": { "type": "text" },
      "filePath": { "type": "keyword" },
      "git_file_hash": { "type": "keyword" },
      "git_branch": { "type": "keyword" },
      "chunk_hash": { "type": "keyword" },
      "startLine": { "type": "integer" },
      "endLine": { "type": "integer" },
      "content": { "type": "text" },
      "content_embedding": { "type": "sparse_vector" },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" }
    }
  }
}
```

---

# Useful "Code Chunk" Fields

The LLM can use the following fields for additional filtering:

- **type**: The type of the code chunk (e.g., `code`, `doc`).
- **language**: The programming language of the code (e.g., `markdown`, `typescript`, `javascript`).
- **kind**:  The specific kind of the code symbol (from LSP) (e.g., `call_expression`, `import_statement`, `comment`, `function_declaration`, `type_alias_declaration`, `interface_declaration`, `lexical_declaration`).
- **imports**: A list of imported modules or libraries.
- **containerPath**:  The path of the containing symbol (e.g., class name for a method).
- **filePath**: The absolute path to the source file.
- **startLine**: The starting line number of the chunk in the file.
- **endLine**: The ending line number of the chunk in the file.

---

# The "Chain of Investigation"

## How an AI can solve complex problems.

A single search is often not enough. An AI agent can use a **"Chain of Investigation"**:

1.  **Initial Broad Query:** Start with a high-level question to find a starting point.
2.  **Analyze & Extract Clues:** Examine the results to find key function names, variable names, or concepts.
3.  **Refine and Deepen:** Launch new, more specific queries using these clues.
4.  **Synthesize:** Repeat the process, building a complete picture before providing the final, comprehensive answer.

---

# The `find_usages` Tool: High-Level Code Intelligence

Before the demos, it's important to highlight a powerful tool that exemplifies the "Chain of Investigation" concept: `find_usages`.

## What it Does

The `find_usages` tool analyzes a code symbol's usage across the entire codebase and generates a rich, categorized report. It's the programmatic equivalent of an IDE's "Find All References" feature, but with added inferential power.

---

## `find_usages`: How it Works (Technically)

Instead of multiple round-trips, the tool uses a single, powerful Elasticsearch query.
1.  It sets `size: 0` as it only needs aggregation results.
2.  It performs a `match` query on the `content` field for the target symbol.
3.  It uses a nested terms aggregation: it first aggregates by `filePath` and then runs sub-aggregations on `kind` and `language` for each file.

This single query efficiently returns all files that mention the symbol, along with a categorized breakdown of *how* the symbol is used in each file.

---

## `find_usages`: Why it's a Game-Changer for an LLM

This tool allows an AI agent to move beyond simple keyword matching and perform high-level code analysis.
-   **Architectural Insight:** By seeing where a symbol is defined, imported, and executed, the agent can quickly understand its architectural role.
-   **Pattern Discovery:** It helps the agent identify common usage patterns and differentiate between modern and legacy implementations.
-   **Reduces Hallucination:** By grounding its analysis in a comprehensive, categorized report, the agent can provide more accurate and context-aware answers.

The `find_usages` tool is a prime example of how a well-designed, high-level tool can empower an AI to reason about a codebase like an experienced engineer.

---

# We will now demonstrate this process.

---

# Demo 1: The Request

## The user asks:

> "Show me an example of how to setup a server route repository"

This is a good, high-level question. It's not asking for a specific function, but for a *concept* or *pattern*. This is where semantic search excels.

---

# Demo 1: The First Search

My first step is to search for the core concepts in the user's prompt.

```bash
code_search --query "server route repository setup"
```

This query is designed to find documents that are semantically related to the idea of setting up a server route repository.

---

# Demo 1: The First Result

## The top result is a README file:

**File:** `src/platform/packages/shared/kbn-server-route-repository/README.md`

**Content Snippet:**
```
The two generic arguments are optional, this example shows a "default" setup which exposes what Core HTTP would normally provide (request, context, response) plus a logger.
```

### **Insight:**
This is a strong indication that this `README.md` file contains the documentation and examples I need. I'll analyze the full content of this file to construct the answer. No further searching is necessary for this prompt.

---

# Demo 1: The Final Answer (Server-Side)

## **Step 1: Create a Route Factory**

First, we use `createServerRouteFactory` to define a factory for our plugin's routes. This sets up the resources (like `request`, `context`, `response`) that will be available to each route handler.

```typescript
// server/create_my_plugin_server_route.ts

import { createServerRouteFactory } from '@kbn/server-route-repository';
import {
  DefaultRouteHandlerResources,
  DefaultRouteCreateOptions,
} from '@kbn/server-route-repository-utils';

export const createMyPluginServerRoute = createServerRouteFactory<
  DefaultRouteHandlerResources,
  DefaultRouteCreateOptions
>();
```

---

# Demo 1: The Final Answer (Server-Side)

## **Step 2: Define a Route**

Next, we use our newly created factory to define a specific route. We provide the `endpoint` and a `handler` function that contains the logic for the route.

```typescript
// server/my_route.ts

import { createMyPluginServerRoute } from './create_my_plugin_server_route';

export const myRoute = createMyPluginServerRoute({
  endpoint: 'GET /internal/my_plugin/route',
  handler: async (resources) => {
    const { request, context, response, logger } = resources;
    return response.ok({
      body: 'Hello, my route!',
    });
  },
});
```
---

# Demo 1: The Final Answer (Server-Side)

## **Step 3: Register the Routes**

Finally, in the plugin's `setup` method, we collect our routes into a `repository` object and use the `registerRoutes` function to make them available to the Kibana server.

We also export the `type` of the repository, which is crucial for the client-side setup.

```typescript
// server/plugin.ts

import { registerRoutes } from '@kbn/server-route-repository';
import { myRoute } from './my_route';

const repository = { ...myRoute };
export type MyPluginRouteRepository = typeof repository;

class MyPlugin implements Plugin {
  public setup(core: CoreSetup) {
    registerRoutes({
      core,
      logger,
      repository,
      dependencies: {},
    });
  }
}
```

---

# Demo 1: The Final Answer (Client-Side)

## **Step 1: Create a Typed Client**

Now, in the browser, we create a client. By importing the `MyPluginRouteRepository` type from the server, `createRepositoryClient` gives us a fully typed client.

This means we get autocompletion for available routes and type checking for requests and responses.

```typescript
// browser/plugin.ts

import { createRepositoryClient } from '@kbn/server-route-repository-client';
import type { MyPluginRouteRepository } from '../server/plugin';

class MyPlugin implements Plugin {
  public setup(core: CoreSetup) {
    const myPluginRepositoryClient =
      createRepositoryClient<MyPluginRouteRepository>(core);

    // ...
  }
}
```

---

# Demo 1: The Final Answer (Client-Side)

## **Step 2: Fetch Data with Confidence**

With the typed client, we can now call our server route using the `fetch` method. The endpoint is type-safe, preventing typos, and the response is automatically typed.

This creates a seamless and safe connection between the server and the browser.

```typescript
// browser/plugin.ts (continued)

myPluginRepositoryClient
  .fetch('GET /internal/my_plugin/route')
  .then((response) => {
    // `response` is inferred to be 'Hello, my route!'
    console.log(response);
  })
  .catch((error) => {
    // ... error handling
  });
```

---

# Demo 2: The Request

## The user asks:

> "Show me an example of how to setup a Lens embeddable using the Lens Config Builder"

This is a more specific request than the last one. The user knows the name of the tool they want to use (`Lens Config Builder`) and what they want to achieve (`setup a Lens embeddable`).

---

# Demo 2: The Search

## I'll search for the key terms in the user's prompt.

```bash
code_search --query "Lens embeddable setup with Lens Config Builder"
```

This query is highly specific, which should lead me directly to relevant examples or documentation.

---

# Demo 2: The Result

## The top result is an example's `README.md` file:

**File:** `x-pack/examples/lens_config_builder_example/README.md`

**Content Snippet:**
```
This example shows how to embed Lens into other applications. Using the `EmbeddableComponent` of the `lens` start plugin,
you can pass in a valid Lens configuration which will get rendered the same way Lens dashboard panels work.
```

### **Insight:**
This is a direct hit. The file is explicitly an example for what the user is asking for. I can be confident that the answer is within this file, and no further investigation is needed.

---

# Demo 2: The Final Answer

## **The `README.md` and `app.tsx` file provide a complete example.**

### **Step 1: Get the `EmbeddableComponent` from the Lens plugin**

In your plugin's `start` method, you can get the `EmbeddableComponent` from the `lens` plugin.

```typescript
// public/app.tsx

const LensComponent = props.plugins.lens.EmbeddableComponent;
```
This component is the key to embedding Lens visualizations. It handles all the data fetching and rendering for you.

---

# Demo 2: The Final Answer

## **Step 2: Define a Lens Configuration**

You define the visualization using a `LensConfig` object. This is where the `LensConfigBuilder` comes in. You can define the chart type, the dataset (using ES|QL), and the values to display.

```typescript
// public/app.tsx

const [lensConfig, setLensConfig] = useState<LensConfig>({
  chartType: 'metric',
  title: 'Total Sales',
  dataset: {
    esql: 'from kibana_sample_data_logs | stats totalBytes = sum(bytes)',
  },
  value: 'totalBytes',
  label: 'Total Bytes Value',
});
```
This configuration is then passed to the `LensConfigBuilder` to create the attributes for the `EmbeddableComponent`.

---

# Demo 2: The Final Answer

## **Step 3: Use the `LensConfigBuilder`**

The `LensConfigBuilder` takes your `LensConfig` and transforms it into the `attributes` that the `EmbeddableComponent` expects.

```typescript
// public/app.tsx

const attributes = useAsync(async () => {
  const configBuilder = new LensConfigBuilder(props.dataViews, props.formula);
  return (await configBuilder.build(lensConfig, {
    embeddable: false,
  })) as TypedLensByValueInput['attributes'];
}, [lensConfig]);
```

This is an asynchronous operation, so it's wrapped in a `useAsync` hook.

---

# Demo 2: The Final Answer

## **Step 4: Render the `EmbeddableComponent`**

Finally, you render the `LensComponent`, passing in the `attributes` generated by the `LensConfigBuilder`. You can also provide a `timeRange`, `style`, and other props to customize the visualization.

```typescript
// public/app.tsx

<LensComponent
  id=""
  withDefaultActions
  style={{ height: 500 }}
  timeRange={time}
  attributes={attributes.value}
  searchSessionId={searchSession}
  viewMode={'view'}
/>
```
And that's it! You have a fully functional, embedded Lens visualization in your application.

---

# Demo 3: The Request

## The user asks:

> "In Discover, there's a full screen button on the data grid table. It looks like it uses CSS to make that table fullscreen but it also hides the kibana chrome (header, etc). Can you show me a snippet of code of how that's accomplished?"

This is a very specific and technical question. The user has a good idea of what's happening (CSS is involved) but wants to see the actual implementation.

---

# Demo 3: The First Search

## I'll start with a broad search to find a starting point.

```bash
code_search --query "Discover data grid table fullscreen CSS hide chrome"
```

This query includes all the key concepts from the user's prompt. I'm not expecting a direct answer, but a clue to start my investigation.

---

# Demo 3: The First Clue

## The top result is a functional test file.

**File:** `src/platform/test/functional/apps/discover/group2_data_grid1/_data_grid.ts`

**Content Snippet:**
```typescript
it('should hide elements beneath the table when in full screen mode...', async () => {
  // ...
  await testSubjects.click('dataGridFullScreenButton');
  // ...
});
```

### **Insight:**
This is a huge clue. The test is interacting with a UI element that has the `testSubject` ID of `dataGridFullScreenButton`. This is the button I need to find.

---

# Demo 3: The Second Clue

## Another search result provides a crucial piece of the puzzle.

**File:** `x-pack/.../use_full_screen/index.test.tsx`

**Content Snippet:**
```typescript
test('setting globalFullScreen to false should remove the chrome removal class...', async () => {
  // ...
  document.body.classList.add('euiDataGrid__restrictBody');
  // ...
});
```

### **Insight:**
This test file reveals the mechanism! It's not just a component, it's a React hook (`useGlobalFullScreen`) that adds a specific CSS class (`euiDataGrid__restrictBody`) to the `document.body`. This is almost certainly how the chrome is hidden.

---

# Demo 3: Following the Trail

## Now I have a very specific target: the `useGlobalFullScreen` hook.

I'll use the `find_usages` tool to locate the definition of this hook.

```bash
find_usages --symbol "useGlobalFullScreen"
```

This search leads me to a single primary definition file:
`x-pack/solutions/security/plugins/security_solution/public/common/containers/use_full_screen/index.tsx`

---

# Demo 3: The Final Answer

## The `useGlobalFullScreen` hook is the key.

By reading the source code of the hook, I can see the exact implementation: `.../use_full_screen/index.tsx`

```typescript
export const useGlobalFullScreen = (): GlobalFullScreen => {
  // ...
  const setGlobalFullScreen = useCallback(
    (fullScreen: boolean) => {
      // ...
      if (fullScreen) {
        document.body.classList.add(SCROLLING_DISABLED_CLASS_NAME, 'euiDataGrid__restrictBody');
      } else {
        document.body.classList.remove(SCROLLING_DISABLED_CLASS_NAME, 'euiDataGrid__restrictBody');
      }
      // ...
    },
    [dispatch]
  );
  // ...
};
```

When `setGlobalFullScreen(true)` is called, the hook adds the `euiDataGrid__restrictBody` class to the `<body>` element. This class, defined in the EUI library, applies the necessary CSS to hide the Kibana chrome and make the data grid appear full-screen.

---

# Demo 4: The Request

## The user asks:

> "I need to create a new context profile for Discover, can you show me a basic example of how to do this?"

This is a conceptual question. The user wants to understand the pattern for creating a new "context profile" within Discover.

---

# Demo 4: The First Search

My first step is to search for the core concepts in the user's prompt.

```bash
code_search --query "create a new context profile for Discover"
```

This query is designed to find documents that are semantically related to the idea of creating a Discover context profile.

---

# Demo 4: The First Result

## The top result is the official documentation for the feature.

**File:** `src/platform/plugins/shared/discover/public/context_awareness/README.md`

**Content Snippet:**
```
One of the core ideas of the context awareness framework is that Discover is still a single application which should know about which profiles it supports and directly import the code needed to support them. This is why profile registrations are all handled internally to the plugin...
```

### **Insight:**
This is a perfect starting point. The `README.md` file explains the architecture and, as I'll find by reading the whole file, contains a complete, copy-pasteable example. No further investigation is needed.

---

# Demo 4: The Final Answer

## **Step 1: Create a Profile Provider**

First, create a file for your profile provider, e.g., `profile.tsx`. This file will export a factory function that returns your profile provider implementation.

```typescript
// profile_providers/common/example_data_source_profile/profile.tsx

export const createExampleDataSourceProfileProvider = (
  services: ProfileProviderServices
): DataSourceProfileProvider => ({
  // ...
});
```

---

# Demo 4: The Final Answer

## **Step 2: Define the Profile**

Inside the provider, define the `profile` object. This object contains methods that map to Discover's extension points. Here, we're extending the `getCellRenderers` to provide a custom renderer for the `message` field.

```typescript
// profile.tsx (continued)

profile: {
  getCellRenderers: (prev) => () => ({
    ...prev(),
    message: (props) => {
      const message = getFieldValue(props.row, 'message');
      return <span>Custom message cell: {message}</span>;
    },
  }),
},
```

---

# Demo 4: The Final Answer

## **Step 3: Implement the `resolve` Method**

The `resolve` method determines if your profile should be active based on the current context (e.g., the data view or ES|QL query). If it's a match, it returns `isMatch: true` and a `context` object.

```typescript
// profile.tsx (continued)

resolve: (params) => {
  // ... logic to determine the index pattern ...

  if (indexPattern !== 'my-example-logs') {
    return { isMatch: false };
  }

  return {
    isMatch: true,
    context: { category: DataSourceCategory.Logs },
  };
},
```

---

# Demo 4: The Final Answer

## **Step 4: Register the Profile Provider**

Finally, in `register_profile_providers.ts`, import your new provider and add it to the appropriate array. The order in this array determines the resolution order.

```typescript
// profile_providers/register_profile_providers.ts

const createDataSourceProfileProviders = (providerServices: ProfileProviderServices) => [
  createExampleDataSourceProfileProvider(providerServices),
  ...createLogsDataSourceProfileProviders(providerServices),
];
```

And that's it! When you navigate to Discover and query an index that matches your `resolve` logic, your new profile will be activated.

---

# Demo 5: The Request

## The user asks:

> "Show me how to parse an ESQL statement and extract the fields used in the STATS command."

This is a technical question that requires finding the right parsing library and understanding how to traverse the Abstract Syntax Tree (AST).

---

# Demo 5: The First Search

My first step is to search for the key concepts.

```bash
code_search --query "parse ESQL statement extract fields STATS command"
```

This query is highly specific and should lead me to the code responsible for parsing ESQL.

---

# Demo 5: The First Result

## The top result is a file from the ESQL AST package.

**File:** `src/platform/packages/shared/kbn-esql-ast/src/mutate/commands/stats/index.ts`

**Content Snippet:**
```typescript
interface StatsFieldSummary {
  /**
   * STATS command argument AST node (as was parsed).
   */
  arg: ESQLProperNode;

  /**
   * The field name, correctly formatted, extracted from the AST.
   */
  field: string;
// ...
}
```

### **Insight:**
This is a direct hit. The file is part of a package named `kbn-esql-ast`, which is clearly the tool for this job. The code also reveals a pattern of using a `Walker` to traverse the AST, which is exactly what I need.

---

# Demo 5: The Final Answer

## **Step 1: Parse the ESQL String**

The first step is to use the `Parser` from `@kbn/esql-ast` to turn the raw ESQL string into an Abstract Syntax Tree (AST).

```typescript
import { Parser } from '@kbn/esql-ast';

const esql = 'FROM my_index | STATS MAX(my_field) BY my_grouping';
const ast = Parser.parse(esql);
```

---

# Demo 5: The Final Answer

## **Step 2: Find the `STATS` Command Node**

Next, we use the `Walker` to find all nodes in the AST that are `STATS` commands.

```typescript
import { Walker } from '@kbn/esql-ast';

const statsNode = Walker.matchAll(ast.root, {
  type: 'command',
  name: 'stats',
});
```

---

# Demo 5: The Final Answer

## **Step 3: Walk the `STATS` Node and Extract Fields**

Finally, we walk the `statsNode` and implement the `visitColumn` method. This method is called for each column (field) found within the `STATS` command. We can then check the `parent` node to see if the field is part of the `BY` clause or an aggregate.

```typescript
const fields = {
  metrics: new Set<string>(),
  dimensions: new Set<string>(),
};

Walker.walk(statsNode, {
  visitColumn: (ctx, parent) => {
    if (parent?.name === 'by') {
      fields.dimensions.add(ctx.name);
    } else {
      fields.metrics.add(ctx.name);
    }
  },
});

// fields.metrics will contain "my_field"
// fields.dimensions will contain "my_grouping"
```

This gives us a simple and reliable way to extract the exact fields used in any `STATS` command.

---

<style scoped>section { font-size: 12px; }</style>

# Appendix: Prompts Used to Create This Presentation

I'm going to be demoing this system in a few days. Can you put together a slide show using markdown files that explains how the indexing works, how the search works, and how an AI can use a "chain of investigation" to implement things in a codebase.

You have access to two powerful tools to accomplish this: `code_search` and `find_usages`.

**1. The `code_search` Tool (For Discovery)**

- **Purpose:** Performs a semantic search of the codebase. It's ideal for broad, conceptual queries to find a starting point or discover relevant files and symbols.
- **Inputs:** `query` (optional string for semantic search), `kql` (optional string for precise filtering), `size`, `page`.
- **How it Works:** It uses ELSER for semantic search and allows for filtering on fields like `filePath`, `kind`, `language`, and `content`.

**2. The `find_usages` Tool (For Analysis)**

- **Purpose:** Analyzes a code symbol's usage across the entire codebase and generates a rich, categorized report. Use this tool *after* discovering a key symbol to quickly understand its architectural role, differentiate between its definition, execution sites, and type declarations, and see where it is referenced.
-  **Input:** A single `symbol` string.
- **How it Works:** It uses a single, efficient Elasticsearch aggregation query. It finds all documents matching the symbol's content and then performs nested aggregations—first by `filePath`, then by `kind` and `language`—to build a comprehensive picture in one shot.
- **Output:** A structured Markdown report categorizing usages into "Primary Definition(s)", "Execution/Call Site(s)", "Import Reference(s)", etc.

Your goal is to tell a story of how an AI can use these tools **in tandem**. A typical workflow, which you should demonstrate, is using `code_search` for initial discovery and then feeding the key symbols from those results into `find_usages` for deeper analysis.

Use these prompts @DEMO_PROMPTS.md

For each prompt, create slides that show your "thought process." It should read like: "The user asked me '{prompt}'... My first step was to use `code_search` to find a starting point... This led me to the symbol '{some_symbol}'. To understand the importance of this symbol, I then used `find_usages`... The report showed me that... Now, with this full context, here is the answer:"

For the indexing, include how we chunk the code using Tree-Sitter, the different types of chunks, and how we chunk the Markdown files. The audience for this presentations is my co-workers at Elastic. Most everyone is familure with RAG and ELSER so a high lever overview would suffice. I would include the schema so people can get a sense of the structure similar to what we included in the `docs/elasticsearch_guide.md` of the chunk documents.
