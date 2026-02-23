# code-runner — Code Interpreter / Code Runner Skill

Execute JavaScript/TypeScript snippets in a sandboxed VM context with no network access, no filesystem access, and configurable timeout enforcement.

## Actions

| Action | Params                                     | Description           |
|--------|--------------------------------------------|-----------------------|
| `run`  | `{ language?, code, timeoutMs? }`         | Execute a code snippet |

## Security

- Uses Node.js `vm` module with a restricted context.
- **No access** to: `require`, `process`, `fs`, `child_process`, `Buffer`, `globalThis`, `eval`, `Function` constructor.
- **Available**: `console.log`, `JSON`, `Math`, `Date`, `Array`, `Object`, `Map`, `Set`, `Promise`, `RegExp`, `String`, `Number`, `Boolean`, and standard built-in types.
- Timeout enforced (default 5s, max 30s).
- Code size limited to 100 KB.

> **Note**: The Node.js `vm` module is NOT a full security sandbox. It prevents accidental access to dangerous APIs but should not be considered escape-proof. For production use with untrusted code, consider using a containerized execution environment.

## TypeScript Support

Basic TypeScript type annotations are stripped before execution. This handles common patterns (type annotations on variables, simple interface/type declarations, `as` casts). For complex TypeScript, pre-compile to JavaScript first.

## CLI Example

```bash
node scripts/test-skill-invoke.js --skill code-runner --action run --params '{"code":"const x = [1,2,3].map(n => n*2); console.log(x); x;"}'
```

## Direct Invocation

```bash
echo '{"action":"run","params":{"language":"js","code":"2+2"},"context":{"agentId":"test","cwd":"."}}' | node skills/code-runner/run.js
```

## Agent Invocation (LLM output)

```
[SKILL:code-runner]{"action":"run","params":{"code":"const fib = n => n <= 1 ? n : fib(n-1) + fib(n-2); fib(10);"}}
```

## Electron UI Flow

The UI calls `window.pinsrAI.invokeSkill('agent-id', 'code-runner', 'run', { code: '...' })` via the IPC bridge.
