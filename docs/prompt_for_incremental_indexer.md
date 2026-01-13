Your task is to add a command that performs an incremental index of a directory that's part of a Git repository. The script's purpose is to update the configured Elasticsearch index with the latest changes that are different from the last `HEAD` commit hash that was indexed. It should be highly efficient by only processing files that have changed.

Here is the high-level strategy:

1.  **Create a settings index** Create an index named `${elasticsearchConfig.index}_settings`, refer to this index as the "settings" index. Use this index to store processing details so they can be recalled by other processes. The first processing detail to store is the commit hash for the current branch being indexed. Update the `index` command to set the commit hash of `HEAD` once it's finished indexing. Treat this index like a NoSQL document store.

1.  **Retrieve Last Indexed Commit:** The script should first check for the last indexed Git commit hash from the "settings" index.

2.  **Identify Changed Files:** Use the `git diff` command to find all files that have been added, modified, or deleted between the last indexed commit and the current `HEAD` of the current branch. This should be a list of file paths.

3.  **Process Changes:**
    * **Deleted Files:** For any deleted file, remove that file’s locations from the index.
      - Location tracking lives in `<index>_locations` (one document per chunk occurrence).
      - Removal deletes all `<index>_locations` docs for the file path, then deletes orphan chunk docs (chunk ids with zero remaining locations).
    * **New/Modified Files:** For new or modified files, re-index their content using the same technique as the `index` command (enqueue → worker bulk index/update).

4.  **Update Last Indexed Commit:** After all changes have been processed successfully, write the current `HEAD` commit hash of the branch to the settings index.

When finished, document the new command in README.md
