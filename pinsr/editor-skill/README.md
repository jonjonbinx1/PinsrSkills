# editor-skill — Editor / Patch Skill

Apply structured edits and patches to files in the agent workspace. Supports unified diff (git-diff) and JSON Patch (RFC 6902) formats with dry-run preview.

## Actions

| Action       | Params                                           | Description           |
|--------------|--------------------------------------------------|-----------------------|
| `applyPatch` | `{ patch, format?, confirm?, targetFile? }`     | Apply a patch to files |

## Params

- **patch** (required): The patch content (unified diff string, or JSON patch array)
- **format**: `"git-diff"` (default) or `"json-patch"`
- **confirm**: `false` for dry-run summary, `true` to actually apply changes
- **targetFile**: Required for `json-patch` format — the file to patch

## Dry-run vs Apply

- When `confirm: false` (default), the skill returns a summary of what would change without modifying any files.
- When `confirm: true`, changes are written to disk and the result includes before/after details.

## Security

- All file paths in patches are validated against the workspace root.
- Directory traversal in patch file paths is rejected.
- Malformed patches produce detailed errors.

## CLI Example

```bash
# Dry run
node scripts/test-skill-invoke.js --skill editor-skill --action applyPatch --params '{"patch":"--- a/test.txt\n+++ b/test.txt\n@@ -1,3 +1,3 @@\n line1\n-old\n+new\n line3","format":"git-diff","confirm":false}'

# Apply
node scripts/test-skill-invoke.js --skill editor-skill --action applyPatch --params '{"patch":"...","format":"git-diff","confirm":true}'
```

## Direct Invocation

```bash
echo '{"action":"applyPatch","params":{"patch":"--- a/test.txt\n+++ b/test.txt\n@@ -1 +1 @@\n-hello\n+world","format":"git-diff","confirm":false},"context":{"agentId":"test","cwd":"."}}' | node skills/editor-skill/run.js
```

## Agent Invocation (LLM output)

```
[SKILL:editor-skill]{"action":"applyPatch","params":{"patch":"--- a/config.json\n+++ b/config.json\n@@ -2,3 +2,3 @@\n {\n-  \"debug\": false\n+  \"debug\": true\n }","format":"git-diff","confirm":true}}
```

## Electron UI Flow

The UI calls `window.pinsrAI.invokeSkill('agent-id', 'editor-skill', 'applyPatch', { patch: '...', confirm: false })` via the IPC bridge.
