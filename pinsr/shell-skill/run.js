#!/usr/bin/env node
'use strict';

/**
 * shell-skill/run.js — Terminal / Shell Skill
 *
 * PinsrAI subprocess protocol:
 *   Input:  { "action": "exec",
 *             "params": { "cmd": "...", "timeoutMs": 30000, "cwd": "." },
 *             "context": { "agentId": "...", "cwd": "..." } }
 *   Output: { "success": true, "output": { "stdout": "...", "stderr": "...", "exitCode": 0 },
 *             "error": null, "metadata": { "durationMs": 123 } }
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PINSR_ROOT = path.join(os.homedir(), '.pinsrAI');

// ─── Dangerous command blocklist ────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /\bsudo\b/i,
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\/\s*$/,  // rm -rf /
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/,
  /\brm\s+-rf\s+\/(?!\S)/,    // rm -rf / (not rm -rf /some/path)
  /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;?\s*:/,  // fork bomb :(){ :|:& };:
  /\bdd\s+.*of=\/dev\//i,       // dd to device
  /\bmkfs\b/i,
  /\bformat\b.*[cC]:/,          // Windows format
  />\s*\/dev\/sd[a-z]/,         // redirect to disk device
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\binit\s+0\b/,
  /\bkill\s+-9\s+(-1|1)\b/,    // kill -9 -1 (kill all)
  /\bchmod\s+-R\s+777\s+\//,   // chmod -R 777 /
  /\bchown\s+-R\s+.*\s+\//,    // chown -R ... /
  /\breg\s+delete\b/i,          // Windows registry delete
  /\bdel\s+\/[sfq]+\s+[cC]:\\/i, // Windows del C:\
];

function isCommandBlocked(cmd) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return { blocked: true, pattern: pattern.toString() };
    }
  }
  return { blocked: false };
}

// ─── Logging ────────────────────────────────────────────────────────────────

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(agentId, level, message) {
  try {
    if (!agentId || agentId === '_unknown') return;
    const logDir = path.join(PINSR_ROOT, 'agents', agentId, 'logs', 'skills');
    ensureDirSync(logDir);
    const logPath = path.join(logDir, 'shell-skill.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [${level}] ${message}\n`);
  } catch { /* ignore */ }
}

// ─── Response helpers ───────────────────────────────────────────────────────

function respond(success, output, error, metadata = {}) {
  const result = JSON.stringify({ success, output, error, metadata });
  process.stdout.write(result + '\n');
  process.exit(success ? 0 : 1);
}

// ─── Path security ──────────────────────────────────────────────────────────

function resolveSafeCwd(requestedCwd, workspaceRoot) {
  const resolved = path.resolve(workspaceRoot, requestedCwd || '.');
  const normalizedRoot = path.resolve(workspaceRoot);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return { safe: false, resolved: null };
  }
  return { safe: true, resolved };
}

// ─── Exec handler ───────────────────────────────────────────────────────────

async function handleExec(params, workspaceRoot, agentId) {
  const { cmd, timeoutMs = 30000, cwd: requestedCwd } = params;

  if (!cmd || typeof cmd !== 'string') {
    return respond(false, null, 'Missing or invalid required param: cmd');
  }

  // Check blocklist
  const blockCheck = isCommandBlocked(cmd);
  if (blockCheck.blocked) {
    log(agentId, 'WARN', `Blocked command: ${cmd} (matched: ${blockCheck.pattern})`);
    return respond(false, null, `Command blocked for safety: matches dangerous pattern. If you believe this is safe, contact the administrator.`, {
      blocked: true,
    });
  }

  // Resolve cwd
  const cwdCheck = resolveSafeCwd(requestedCwd, workspaceRoot);
  if (!cwdCheck.safe) {
    return respond(false, null, 'Requested cwd is outside the workspace');
  }

  const execCwd = cwdCheck.resolved;
  if (!fs.existsSync(execCwd)) {
    return respond(false, null, `Working directory does not exist: ${requestedCwd || '.'}`);
  }

  log(agentId, 'INFO', `Executing: ${cmd} (cwd: ${execCwd}, timeout: ${timeoutMs}ms)`);
  const startTime = Date.now();

  return new Promise((resolve) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;
    let timedOut = false;

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/c', cmd] : ['-c', cmd];

    const child = spawn(shell, shellArgs, {
      cwd: execCwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, 2000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdoutBuf += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      log(agentId, 'ERROR', `Command error: ${err.message} (${durationMs}ms)`);
      respond(false, { stdout: stdoutBuf, stderr: stderrBuf, exitCode: null }, `Process error: ${err.message}`, {
        durationMs,
        cmd,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (timedOut) {
        log(agentId, 'WARN', `Command timed out: ${cmd} (${durationMs}ms)`);
        respond(false, { stdout: stdoutBuf, stderr: stderrBuf, exitCode: code }, `Command timed out after ${timeoutMs}ms`, {
          durationMs,
          timedOut: true,
          cmd,
        });
        return;
      }

      log(agentId, 'INFO', `Command completed: exit=${code} duration=${durationMs}ms`);
      respond(code === 0, {
        stdout: stdoutBuf,
        stderr: stderrBuf,
        exitCode: code,
      }, code !== 0 ? `Command exited with code ${code}` : null, {
        durationMs,
        cmd,
      });
    });
  });
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
    const cwd = context.cwd || process.cwd();

    if (action !== 'exec') {
      respond(false, null, `Unknown action: "${action}". Supported: exec`, { durationMs: Date.now() - startTime });
      return;
    }

    handleExec(params, cwd, agentId).catch((err) => {
      log(agentId, 'ERROR', `exec failed: ${err.message}`);
      respond(false, null, `exec failed: ${err.message}`, { durationMs: Date.now() - startTime });
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
