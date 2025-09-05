Replace FileQueue with SqliteQueue

- Replaced the file-based queue system with a more scalable and robust SQLite-based implementation to prevent inode exhaustion on large codebases.
- Introduced `better-sqlite3` for efficient database operations.
- Created a new `SqliteQueue` class with a transactional approach to queuing.
- Added a scalability test to verify the new queue can handle over 100,000 documents.
- Implemented a `monitor-queue` command to provide real-time statistics about the queue.
- Updated the logger to support a silent mode for cleaner test outputs.

Prompts:

- "We just added a new file queue to the indexer. I realized that we need to come up with a hashing strategy for the file storage because one of my code based is over 80K files and we would likely exceed the inodes for the directories. Another option to explore might be using something like `SQLLite` for the queue instead of the file system. Create an epic issue via Github MCP tool on `elastic/semantic-code-search-indexer` repo with the plan and sub-issues for each phase. Be descriptive enough that if this chat sesssion were lost I could point a fresh new Gemini CLI session to the Epic and it could pick a phase and continue the work."
- "How does that work with multiple workers?"
- "Sounds good... Let's proceed with SQLite implimentation and phase 2"
- "Can we keep the file queue intact until we've tested the new functionality?"
- "You don't even need to do that... I just want to use the SQLite version to index some docs, then we can delete the FileQueue"
- "Which document id did you use for SQLite?"
- "Looks like it's working :D You can remove the FileQueue"
- "Can you update the Phase 2 issue (#17) and close it?"
- "Looks like phase 3 is complete as well?"
- "Yes..."
- "One more thing.... Can we create a `npm run monitor-queue` command that will give us stats about the queue?"
- "Can you run `npm run build`?"
- "I like the monitor-queue command... Can we put the "age" next to the `Oldest Document` date like in parenthesis `(1 minute)`"
- "I think we should use the `toNow` function:"
- "That timestamp is UTC?"
- "Can we have the toNow compare to UTC?"
- "Perfect!"

🤖 This commit was assisted by Gemini CLI
