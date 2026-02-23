#!/usr/bin/env node
'use strict';

/**
 * code-runner/run.js — Code Interpreter / Code Runner Skill
 *
 * Executes JavaScript snippets in a sandboxed VM context.
 * Uses Node.js built-in `vm` module with restricted context.
 *
 * PinsrAI subprocess protocol:
 *   Input:  { "action": "run",
 *             "params": { "language": "js"|"ts", "code": "...", "timeoutMs": 5000 },
 *             "context": { "agentId": "...", "cwd": "..." } }
 *   Output: { "success": true, "output": { "result": ..., "stdout": "...", "stderr": "..." },
 *             "error": null, "metadata": { "durationMs": 123 } }
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PINSR_ROOT = path.join(os.homedir(), '.pinsrAI');
const DEFAULT_TIMEOUT = 5000;
const MAX_TIMEOUT = 30000;
const MAX_CODE_LENGTH = 100000; // 100KB

// ─── Logging ────────────────────────────────────────────────────────────────

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(agentId, level, message) {
  try {
    if (!agentId || agentId === '_unknown') return;
    const logDir = path.join(PINSR_ROOT, 'agents', agentId, 'logs', 'skills');
    ensureDirSync(logDir);
    const logPath = path.join(logDir, 'code-runner.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [${level}] ${message}\n`);
  } catch { /* ignore */ }
}

// ─── Response helpers ───────────────────────────────────────────────────────

function respond(success, output, error, metadata = {}) {
  process.stdout.write(JSON.stringify({ success, output, error, metadata }) + '\n');
  process.exit(success ? 0 : 1);
}

// ─── Basic TypeScript-to-JavaScript transform ───────────────────────────────

/**
 * Strip basic TypeScript type annotations for simple snippets.
 * This is NOT a full TS compiler — it handles common patterns only.
 * For full TS support, use ts-node or similar.
 */
function stripTypeAnnotations(code) {
  // Remove type annotations from variable declarations: let x: number = 5
  let result = code.replace(/:\s*[A-Za-z<>\[\]|&{},\s?]+(?=\s*[=;,)\n])/g, (match) => {
    // Don't remove ternary operators
    if (match.includes('?') && match.includes(':')) return match;
    return '';
  });

  // Remove interface/type declarations (simple single-line)
  result = result.replace(/^(export\s+)?(interface|type)\s+\w+[^{]*\{[^}]*\}$/gm, '');

  // Remove 'as Type' casts
  result = result.replace(/\s+as\s+[A-Za-z<>\[\]|&{},\s]+/g, '');

  return result;
}

// ─── Sandbox execution ──────────────────────────────────────────────────────

function executeInSandbox(code, timeoutMs) {
  const consoleOutput = [];
  const consoleErrors = [];

  // Build a restricted sandbox context
  const sandbox = {
    // Safe globals
    console: {
      log: (...args) => consoleOutput.push(args.map(String).join(' ')),
      error: (...args) => consoleErrors.push(args.map(String).join(' ')),
      warn: (...args) => consoleErrors.push(args.map(String).join(' ')),
      info: (...args) => consoleOutput.push(args.map(String).join(' ')),
      debug: (...args) => consoleOutput.push(args.map(String).join(' ')),
    },
    // Standard built-ins
    JSON,
    Math,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    URIError,
    // Utility
    setTimeout: (fn, ms) => {
      // Limited setTimeout — only synchronous resolution for simple cases
      if (ms > timeoutMs) throw new Error('setTimeout delay exceeds allowed timeout');
      return setTimeout(fn, Math.min(ms, 1000));
    },
    clearTimeout,
    undefined,
    NaN,
    Infinity,
  };

  // Explicitly deny dangerous globals
  sandbox.require = undefined;
  sandbox.process = undefined;
  sandbox.global = undefined;
  sandbox.globalThis = undefined;
  sandbox.__dirname = undefined;
  sandbox.__filename = undefined;
  sandbox.module = undefined;
  sandbox.exports = undefined;
  sandbox.Buffer = undefined;

  const context = vm.createContext(sandbox);

  try {
    const script = new vm.Script(code, {
      filename: 'sandbox.js',
      timeout: timeoutMs,
    });

    const result = script.runInContext(context, {
      timeout: timeoutMs,
      displayErrors: true,
    });

    return {
      success: true,
      result: result !== undefined ? String(result) : undefined,
      stdout: consoleOutput.join('\n'),
      stderr: consoleErrors.join('\n'),
    };
  } catch (err) {
    return {
      success: false,
      result: null,
      stdout: consoleOutput.join('\n'),
      stderr: consoleErrors.join('\n'),
      error: err.message || String(err),
    };
  }
}

// ─── Run handler ────────────────────────────────────────────────────────────

async function handleRun(params, agentId) {
  const { language = 'js', code, timeoutMs = DEFAULT_TIMEOUT } = params;

  if (!code || typeof code !== 'string') {
    return respond(false, null, 'Missing or invalid required param: code');
  }

  if (code.length > MAX_CODE_LENGTH) {
    return respond(false, null, `Code too large: ${code.length} chars (max ${MAX_CODE_LENGTH})`);
  }

  const effectiveTimeout = Math.min(Math.max(timeoutMs, 100), MAX_TIMEOUT);
  const lang = (language || 'js').toLowerCase();

  // Check for disallowed patterns (attempts to escape sandbox)
  const disallowedPatterns = [
    /\brequire\s*\(/,
    /\bprocess\b/,
    /\bchild_process\b/,
    /\b__dirname\b/,
    /\b__filename\b/,
    /\bglobalThis\b/,
    /\bFunction\s*\(/,
    /\beval\s*\(/,
  ];

  for (const pattern of disallowedPatterns) {
    if (pattern.test(code)) {
      log(agentId, 'WARN', `Blocked code pattern: ${pattern.toString()}`);
      return respond(false, null, `Code contains disallowed pattern: ${pattern.toString().replace(/\//g, '')}. Sandbox does not provide require, process, eval, Function constructor, or filesystem access.`);
    }
  }

  let jsCode = code;

  if (lang === 'ts' || lang === 'typescript') {
    log(agentId, 'INFO', 'Stripping TypeScript annotations (basic transform)');
    jsCode = stripTypeAnnotations(code);
  } else if (lang !== 'js' && lang !== 'javascript') {
    return respond(false, null, `Unsupported language: "${language}". Supported: js, ts`);
  }

  log(agentId, 'INFO', `Running code (${jsCode.length} chars, timeout: ${effectiveTimeout}ms)`);
  const startTime = Date.now();

  const result = executeInSandbox(jsCode, effectiveTimeout);
  const durationMs = Date.now() - startTime;

  log(agentId, 'INFO', `Code execution ${result.success ? 'succeeded' : 'failed'} (${durationMs}ms)`);

  if (result.success) {
    respond(true, {
      result: result.result,
      stdout: result.stdout,
      stderr: result.stderr,
    }, null, { durationMs, language: lang });
  } else {
    respond(false, {
      result: null,
      stdout: result.stdout,
      stderr: result.stderr,
    }, result.error || 'Code execution failed', { durationMs, language: lang });
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

let inputData = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { inputData += chunk; });
process.stdin.on('end', () => {
  const startTime = Date.now();
  try {
    const input = JSON.parse(inputData.trim());
    const { action, params = {}, context = {} } = input;
    const agentId = context.agentId || '_unknown';

    if (action !== 'run') {
      respond(false, null, `Unknown action: "${action}". Supported: run`, { durationMs: Date.now() - startTime });
      return;
    }

    handleRun(params, agentId).catch((err) => {
      log(agentId, 'ERROR', `Run failed: ${err.message}`);
      respond(false, null, `Run failed: ${err.message}`, { durationMs: Date.now() - startTime });
    });
  } catch (err) {
    respond(false, null, `Failed to parse input: ${err.message}`, { durationMs: Date.now() - startTime });
  }
});

setTimeout(() => {
  if (!inputData) {
    respond(false, null, 'No input received (stdin timeout)', {});
  }
}, 5000);
