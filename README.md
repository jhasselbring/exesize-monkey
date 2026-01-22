# npx-cluster-size-suggestion

Suggest a cluster size based on the contents of a file or directory.

## Usage
```
npx npx-cluster-size-suggestion [path]
```

If no path is provided, the current directory is used.

## Output fields
- Files scanned
- Total size
- Average file size
- Largest file
- Suggested cluster size (recommended number of worker nodes)

## Notes
- Symbolic links are skipped to avoid cycles.
