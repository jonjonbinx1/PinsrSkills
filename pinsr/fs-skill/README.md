# fs-skill — File System Skill

Read/write/append/delete/list/stat files inside the agent workspace with directory traversal protection.

## Actions

| Action          | Params                                       | Description            |
|-----------------|----------------------------------------------|------------------------|
| `readFile`      | `{ path, encoding? }`                        | Read file contents     |
| `writeFile`     | `{ path, content, encoding? }`               | Write/create a file    |
| `appendFile`    | `{ path, content, encoding? }`               | Append to a file       |
| `deleteFile`    | `{ path }`                                   | Delete a file          |
| `listDirectory` | `{ path? }`                                  | List directory entries  |
| `stat`          | `{ path }`                                   | Get file metadata      |

## Security

- All paths are resolved relative to `context.cwd` (agent workspace root).
- Directory traversal (`../`) that escapes the workspace is rejected.
- Maximum write size: 10 MB. Maximum read size: 50 MB.
- Audit logs written to `~/.pinsrAI/agents/<agent-id>/logs/skills/fs-skill.log`.

## CLI Example

```bash
node scripts/test-skill-invoke.js --skill fs-skill --action readFile --params '{"path":"README.md"}'
```

## Direct Invocation

```bash
echo '{"action":"readFile","params":{"path":"README.md"},"context":{"agentId":"test","cwd":"."}}' | node skills/fs-skill/run.js
```

## Agent Invocation (LLM output)

```
[SKILL:fs-skill]{"action":"readFile","params":{"path":"src/index.ts"}}
```

## Electron UI Flow

The UI calls `window.pinsrAI.invokeSkill('agent-id', 'fs-skill', 'readFile', { path: 'README.md' })` via the IPC bridge, which delegates to `SkillRegistry.invokeSkill()`.
