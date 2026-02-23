# shell-skill — Terminal / Shell Skill

Execute shell commands safely inside the agent workspace with timeout enforcement and dangerous-command blocking.

## Actions

| Action | Params                                  | Description         |
|--------|-----------------------------------------|---------------------|
| `exec` | `{ cmd, timeoutMs?, cwd? }`            | Execute a command   |

## Security

- Commands are executed with the workspace as the working directory.
- A blocklist prevents dangerous patterns: `sudo`, `rm -rf /`, fork bombs, `dd` to devices, `shutdown`, `reboot`, `mkfs`, etc.
- Timeout enforcement (default 30s) kills the process with SIGTERM then SIGKILL.
- The `cwd` param is sandboxed to the workspace root.

## CLI Example

```bash
node scripts/test-skill-invoke.js --skill shell-skill --action exec --params '{"cmd":"echo hello world"}'
```

## Direct Invocation

```bash
echo '{"action":"exec","params":{"cmd":"echo hello"},"context":{"agentId":"test","cwd":"."}}' | node skills/shell-skill/run.js
```

## Agent Invocation (LLM output)

```
[SKILL:shell-skill]{"action":"exec","params":{"cmd":"npm test","timeoutMs":60000}}
```

## Electron UI Flow

The UI calls `window.pinsrAI.invokeSkill('agent-id', 'shell-skill', 'exec', { cmd: 'npm test' })` via the IPC bridge.
