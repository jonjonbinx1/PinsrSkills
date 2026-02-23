#!/usr/bin/env node
'use strict';

/**
 * fs-skill/run.js — File System Skill
 *
 * PinsrAI subprocess protocol:
 *   Input:  { "action": "readFile|writeFile|appendFile|deleteFile|listDirectory|stat",
 *             "params": { "path": "...", "content": "...", "encoding": "utf8" },
 *             "context": { "agentId": "...", "cwd": "..." } }
 *   Output: { "success": true, "output": {...}, "error": null, "metadata": {...} }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PINSR_ROOT = path.join(os.homedir(), '.pinsrAI');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB default write limit
const MAX_READ_SIZE = 50 * 1024 * 1024; // 50 MB default read limit

// Skill name used for config filenames
const SKILL_NAME = 'fs-skill';

// ─── Allowed-paths enforcement helpers ───────────────────────────────────

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function parseAllowedPathsFromYaml(content) {
  // Minimal YAML parsing to extract top-level `allowedPaths:` array.
  // Supports both block list and inline array formats.
  const lines = content.split(/\r?\n/);
  let inBlock = false;
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!inBlock) {
      // inline: allowedPaths: ["a", "b"]
      const inlineMatch = line.match(/^allowedPaths:\s*\[(.*)\]\s*$/);
      if (inlineMatch) {
        const inner = inlineMatch[1].trim();
        if (inner) {
          // split on commas not inside quotes (simple)
          const parts = inner.split(/,\s*/).map(s => s.replace(/^\s*['\"]?|['\"]?\s*$/g, ''));
          parts.forEach(p => { if (p) results.push(p); });
        }
        continue;
      }
      if (line.startsWith('allowedPaths:')) {
        // If it's exactly 'allowedPaths:' then start block
        if (/^allowedPaths:\s*$/.test(line)) {
          inBlock = true; continue;
        }
      }
    } else {
      // block entries: - path
      if (/^[\-]\s+/.test(line)) {
        const entry = line.replace(/^[\-]\s+/, '').replace(/^['\"]|['\"]$/g, '');
        if (entry) results.push(entry);
        continue;
      }
      // end of block if next top-level key
      if (line && !line.startsWith('-')) break;
    }
  }
  return results;
}

function loadAllowedPathsConfig(agentId, workspaceRoot) {
  // Precedence: per-agent -> global. Returns array of absolute resolved allowed paths (only those inside workspaceRoot).
  try {
    const agentConfig = path.join(PINSR_ROOT, 'agents', agentId, 'skill-config', `${SKILL_NAME}.yaml`);
    const globalConfig = path.join(PINSR_ROOT, 'skill-config', `${SKILL_NAME}.yaml`);

    let content = null;
    if (fileExists(agentConfig)) content = fs.readFileSync(agentConfig, 'utf8');
    else if (fileExists(globalConfig)) content = fs.readFileSync(globalConfig, 'utf8');
    if (!content) return [];

    const entries = parseAllowedPathsFromYaml(content);
    const resolved = [];
    for (const e of entries) {
      // If relative (starts with ./ or not absolute), resolve against workspaceRoot
      let candidate = e;
      if (!path.isAbsolute(candidate)) candidate = path.resolve(workspaceRoot, candidate);
      else candidate = path.resolve(candidate);

      // Prefer realpath when possible
      try { if (fileExists(candidate)) candidate = fs.realpathSync(candidate); } catch (err) { /* leave candidate as-is */ }

      // Only include entries that are inside the workspaceRoot to avoid granting external access by default
      const normalizedRoot = path.resolve(workspaceRoot);
      if (candidate === normalizedRoot || candidate.startsWith(normalizedRoot + path.sep)) {
        resolved.push(candidate);
      }
    }
    return resolved;
  } catch (err) {
    return [];
  }
}

function isTargetAllowedByList(targetResolved, allowedList, workspaceRoot) {
  if (!allowedList || allowedList.length === 0) return true; // empty allowlist => no restriction beyond workspace
  const normalizedRoot = path.resolve(workspaceRoot);
  for (const allowed of allowedList) {
    if (!allowed) continue;
    const a = path.resolve(allowed);
    // If allowed is a directory (ends with sep or exists as directory), allow children
    try {
      if (fs.existsSync(a) && fs.statSync(a).isDirectory()) {
        if (targetResolved === a || targetResolved.startsWith(a + path.sep)) return true;
      } else {
        // file equality
        if (targetResolved === a) return true;
      }
    } catch (e) {
      // if stat fails, skip
      continue;
    }
  }
  return false;
}

// ─── Logging ────────────────────────────────────────────────────────────────

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getLogPath(agentId) {
  const logDir = path.join(PINSR_ROOT, 'agents', agentId, 'logs', 'skills');
  ensureDirSync(logDir);
  return path.join(logDir, 'fs-skill.log');
}

function log(agentId, level, message) {
  try {
    if (!agentId || agentId === '_unknown') return;
    const logPath = getLogPath(agentId);
    const entry = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    fs.appendFileSync(logPath, entry);
  } catch { /* don't let logging break the skill */ }
}

// ─── Response helpers ───────────────────────────────────────────────────────

function respond(success, output, error, metadata = {}) {
  const result = JSON.stringify({ success, output, error, metadata });
  process.stdout.write(result + '\n');
  process.exit(success ? 0 : 1);
}

// ─── Path security ──────────────────────────────────────────────────────────

function resolveSafePath(relativePath, workspaceRoot) {
  // Normalize and resolve the path relative to the workspace root
  const resolved = path.resolve(workspaceRoot, relativePath);
  const normalizedRoot = path.resolve(workspaceRoot);

  // Ensure resolved path is inside workspace root
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return { safe: false, resolved: null, error: `Path traversal denied: "${relativePath}" resolves outside workspace` };
  }

  return { safe: true, resolved, error: null };
}

// Return a workspace-relative POSIX-style path (e.g. "task/task.md").
function toRelativePosix(resolvedPath, workspaceRoot) {
  let rel = path.relative(workspaceRoot, resolvedPath);
  // Normalize backslashes to forward slashes for consistent cross-platform output
  rel = rel.replace(/\\/g, '/').replace(/\\/g, '/').replace(/\\/g, '/');
  rel = rel.replace(/\\/g, '/');
  if (!rel || rel === '') return '.';
  return rel.split(path.sep).join('/');
}

// ─── Action handlers ────────────────────────────────────────────────────────

async function handleReadFile(params, workspaceRoot, agentId) {
  const { path: filePath, encoding = 'utf8' } = params;
  if (!filePath) return respond(false, null, 'Missing required param: path');
  const { safe, resolved, error } = resolveSafePath(filePath, workspaceRoot);
  if (!safe) return respond(false, null, error);

  // Enforce allowedPaths policy (if configured)
  try {
    const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
    }
  } catch (e) { /* on error, fall through to normal checks */ }

  const relRequested = toRelativePosix(resolved, workspaceRoot);
  if (!fs.existsSync(resolved)) {
    return respond(false, { path: relRequested }, `File not found: ${relRequested}`);
  }

  const stats = fs.statSync(resolved);
  if (stats.size > MAX_READ_SIZE) {
    return respond(false, null, `File too large: ${stats.size} bytes (max ${MAX_READ_SIZE})`);
  }

  log(agentId, 'DEBUG', `readFile: ${resolved} (${stats.size} bytes)`);
  const content = fs.readFileSync(resolved, encoding);

  respond(true, { content, path: relRequested, found: true }, null, {
    size: stats.size,
    mtime: stats.mtime.toISOString(),
    encoding,
  });
}

async function handleWriteFile(params, workspaceRoot, agentId) {
  const { path: filePath, content, encoding = 'utf8' } = params;
  if (!filePath) return respond(false, null, 'Missing required param: path');
  if (content === undefined || content === null) return respond(false, null, 'Missing required param: content');
  const { safe, resolved, error } = resolveSafePath(filePath, workspaceRoot);
  if (!safe) return respond(false, null, error);

  // Enforce allowedPaths policy (if configured)
  try {
    const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
    }
  } catch (e) {}

  const contentBuffer = Buffer.from(content, encoding);
  if (contentBuffer.length > MAX_FILE_SIZE) {
    return respond(false, null, `Content too large: ${contentBuffer.length} bytes (max ${MAX_FILE_SIZE})`);
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(resolved);
  ensureDirSync(parentDir);

  log(agentId, 'DEBUG', `writeFile: ${resolved} (${contentBuffer.length} bytes)`);
  fs.writeFileSync(resolved, content, encoding);

  const stats = fs.statSync(resolved);
  const relOut = toRelativePosix(resolved, workspaceRoot);
  respond(true, { path: relOut, bytesWritten: contentBuffer.length }, null, {
    size: stats.size,
    mtime: stats.mtime.toISOString(),
  });
}

async function handleAppendFile(params, workspaceRoot, agentId) {
  const { path: filePath, content, encoding = 'utf8' } = params;
  if (!filePath) return respond(false, null, 'Missing required param: path');
  if (content === undefined || content === null) return respond(false, null, 'Missing required param: content');

  const { safe, resolved, error } = resolveSafePath(filePath, workspaceRoot);
  if (!safe) return respond(false, null, error);

  // Enforce allowedPaths policy (if configured)
  try {
    const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
    }
  } catch (e) {}

  const contentBuffer = Buffer.from(content, encoding);
  if (contentBuffer.length > MAX_FILE_SIZE) {
    return respond(false, null, `Content too large: ${contentBuffer.length} bytes (max ${MAX_FILE_SIZE})`);
  }

  // Ensure parent directory exists
  ensureDirSync(path.dirname(resolved));

  log(agentId, 'DEBUG', `appendFile: ${resolved} (${contentBuffer.length} bytes)`);
  fs.appendFileSync(resolved, content, encoding);

  const stats = fs.statSync(resolved);
  const relOut = toRelativePosix(resolved, workspaceRoot);
  respond(true, { path: relOut, bytesAppended: contentBuffer.length }, null, {
    size: stats.size,
    mtime: stats.mtime.toISOString(),
  });
}

async function handleDeleteFile(params, workspaceRoot, agentId) {
  const { path: filePath } = params;
  if (!filePath) return respond(false, null, 'Missing required param: path');

  const { safe, resolved, error } = resolveSafePath(filePath, workspaceRoot);
  if (!safe) return respond(false, null, error);

  const relRequested = toRelativePosix(resolved, workspaceRoot);
  if (!fs.existsSync(resolved)) {
    return respond(false, { path: relRequested }, `File not found: ${relRequested}`);
  }

  log(agentId, 'DEBUG', `deleteFile: ${resolved}`);
  fs.unlinkSync(resolved);

  const relOut = toRelativePosix(resolved, workspaceRoot);
  respond(true, { path: relOut, deleted: true }, null, {});
}

async function handleListDirectory(params, workspaceRoot, agentId) {
  const { path: dirPath = '.', recursive = false } = params;

  const { safe, resolved, error } = resolveSafePath(dirPath, workspaceRoot);
  if (!safe) return respond(false, null, error);

  const relRequested = toRelativePosix(resolved, workspaceRoot);
  if (!fs.existsSync(resolved)) {
    return respond(false, { path: relRequested }, `Directory not found: ${relRequested}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return respond(false, { path: relRequested }, `Not a directory: ${relRequested}`);
  }

  log(agentId, 'DEBUG', `listDirectory: ${resolved}`);

  // Enforce allowedPaths policy (if configured)
  try {
    const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${dirPath}`);
    }
  } catch (e) {}

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const items = entries.map((entry) => {
    const childResolved = path.join(resolved, entry.name);
    return {
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      path: toRelativePosix(childResolved, workspaceRoot),
    };
  });

  respond(true, { path: relRequested, entries: items, count: items.length }, null, {});
}

async function handleStat(params, workspaceRoot, agentId) {
  const { path: filePath } = params;
  if (!filePath) return respond(false, null, 'Missing required param: path');

  const { safe, resolved, error } = resolveSafePath(filePath, workspaceRoot);
  if (!safe) return respond(false, null, error);

  // Enforce allowedPaths policy (if configured)
  try {
    const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
    }
  } catch (e) {}
  const relRequested = toRelativePosix(resolved, workspaceRoot);
  if (!fs.existsSync(resolved)) {
    return respond(false, { path: relRequested }, `Path not found: ${relRequested}`);
  }

  log(agentId, 'DEBUG', `stat: ${resolved}`);
  const stats = fs.statSync(resolved);

  respond(true, {
    path: relRequested,
    size: stats.size,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    mtime: stats.mtime.toISOString(),
    ctime: stats.ctime.toISOString(),
    atime: stats.atime.toISOString(),
    mode: stats.mode.toString(8),
  }, null, {});
}

// ─── Main ───────────────────────────────────────────────────────────────────

const ACTION_MAP = {
  readFile: handleReadFile,
  writeFile: handleWriteFile,
  appendFile: handleAppendFile,
  deleteFile: handleDeleteFile,
  listDirectory: handleListDirectory,
  listFiles: handleListDirectory,
  list: handleListDirectory,
  stat: handleStat,
};

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

    log(agentId, 'INFO', `Action: ${action} Params: ${JSON.stringify(params)}`);

    const handler = ACTION_MAP[action];
    if (!handler) {
      respond(false, null, `Unknown action: "${action}". Supported: ${Object.keys(ACTION_MAP).join(', ')}`, {
        durationMs: Date.now() - startTime,
      });
      return;
    }

    handler(params, cwd, agentId).catch((err) => {
      log(agentId, 'ERROR', `Action ${action} failed: ${err.message}`);
      respond(false, null, `Action failed: ${err.message}`, { durationMs: Date.now() - startTime });
    });
  } catch (err) {
    respond(false, null, `Failed to parse input: ${err.message}`, { durationMs: Date.now() - startTime });
  }
});

// Handle empty stdin timeout
setTimeout(() => {
  if (!inputData) {
    respond(false, null, 'No input received (stdin timeout)', {});
  }
}, 5000);
