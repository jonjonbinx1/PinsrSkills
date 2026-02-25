#!/usr/bin/env node
'use strict';

/**
 * fs-skill/run.js — File System Skill
 *
 * PinsrAI subprocess protocol:
 *   Input:  { "action": "readRaw|deleteFile|listDirectory|stat|exists|copyFile|moveFile|createDirectory|deleteDirectory|setPermissions|getPermissions|getAllowedPaths",
 *             "params": { "path": "...", ... },
 *             "context": { "agentId": "...", "cwd": "..." } }
 *   Output: { "success": true, "output": {...}, "error": null, "metadata": {...} }
 *
 * NOTE: File content creation and editing belong to editor-skill.
 *       Use editor-skill for createFile, appendContent, insertContent, replaceRange, applyPatch.
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

function parseNamedYamlList(name, content) {
  // Minimal YAML parsing to extract top-level `<name>:` array.
  const lines = content.split(/\r?\n/);
  let inBlock = false;
  const results = [];
  const inlineRegex = new RegExp(`^${name}:\\s*\\[(.*)\\]\\s*$`);
  const blockStartRegex = new RegExp(`^${name}:\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!inBlock) {
      const inlineMatch = line.match(inlineRegex);
      if (inlineMatch) {
        const inner = inlineMatch[1].trim();
        if (inner) {
          const parts = inner.split(/,\s*/).map(s => s.replace(/^\s*['\"]?|['\"]?\s*$/g, ''));
          parts.forEach(p => { if (p) results.push(p); });
        }
        continue;
      }
      if (line.startsWith(name + ':')) {
        if (blockStartRegex.test(line)) { inBlock = true; continue; }
      }
    } else {
      if (/^[\-]\s+/.test(line)) {
        const entry = line.replace(/^[\-]\s+/, '').replace(/^['\"]|['\"]$/g, '');
        if (entry) results.push(entry);
        continue;
      }
      if (line && !line.startsWith('-')) break;
    }
  }
  return results;
}

function parseAllowedPathsFromYaml(content) { return parseNamedYamlList('allowedPaths', content); }

function loadAllowedPathsConfig(agentId, workspaceRoot) {
  // Precedence: per-agent -> global. Returns array of absolute resolved allowed paths (only those inside workspaceRoot).
  try {
    const agentConfig = path.join(PINSR_ROOT, 'agents', agentId, 'skill-config', `${SKILL_NAME}.yaml`);
    const globalConfig = path.join(PINSR_ROOT, 'skill-config', `${SKILL_NAME}.yaml`);

    let content = null;
    let source = null; // 'agent' | 'global'
    if (fileExists(agentConfig)) { content = fs.readFileSync(agentConfig, 'utf8'); source = 'agent'; }
    else if (fileExists(globalConfig)) { content = fs.readFileSync(globalConfig, 'utf8'); source = 'global'; }
    if (!content) return [];

    const entries = parseAllowedPathsFromYaml(content);
    const externalEntriesRaw = parseNamedYamlList('externalAllowedPaths', content);
    const resolved = [];
    // Resolve externalAllowedPaths entries to canonical absolute paths for comparison
    const externalResolved = [];
    for (const ex of externalEntriesRaw) {
      if (!ex || String(ex).trim() === '') continue;
      let exCand = ex;
      if (!path.isAbsolute(exCand)) exCand = path.resolve(workspaceRoot, exCand);
      else exCand = path.resolve(exCand);
      try { if (fileExists(exCand)) exCand = fs.realpathSync(exCand); } catch (err) { /* keep exCand */ }
      externalResolved.push(exCand);
      // Also include external entries in resolved list so getAllowedPaths reports them
      resolved.push(exCand);
    }

    for (const e of entries) {
      if (!e || String(e).trim() === '') continue;
      let candidate = e;
      if (!path.isAbsolute(candidate)) candidate = path.resolve(workspaceRoot, candidate);
      else candidate = path.resolve(candidate);
      try { if (fileExists(candidate)) candidate = fs.realpathSync(candidate); } catch (err) { /* leave candidate as-is */ }

      const normalizedRoot = path.resolve(workspaceRoot);
      if (candidate === normalizedRoot || candidate.startsWith(normalizedRoot + path.sep)) {
        resolved.push(candidate);
        continue;
      }

      // If candidate is absolute and outside workspace, include when:
      // - it's listed in externalAllowedPaths, OR
      // - it came from a per-agent config (source === 'agent') and the user saved it there
      if (path.isAbsolute(e)) {
        let added = false;
        for (const ex of externalResolved) {
          if (ex === candidate) { resolved.push(candidate); added = true; break; }
        }
        if (!added && source === 'agent') {
          // honor agent-config absolute entries per user preference
          resolved.push(candidate);
        }
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

async function handleReadRaw(params, workspaceRoot, agentId) {
  const { path: filePath, start, end, encoding } = params || {};
  if (!filePath) return respond(false, null, 'Missing required param: path');
  const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);

  let resolved;
  if (path.isAbsolute(filePath)) {
    resolved = path.resolve(filePath);
    try { if (fileExists(resolved)) resolved = fs.realpathSync(resolved); } catch (e) {}
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot))
      return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
  } else {
    const { safe, resolved: r, error } = resolveSafePath(filePath, workspaceRoot);
    if (!safe) return respond(false, null, error);
    resolved = r;
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot))
      return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
  }

  const relRequested = toRelativePosix(resolved, workspaceRoot);
  if (!fs.existsSync(resolved))
    return respond(false, { path: relRequested }, `File not found: ${relRequested}`);

  const stats = fs.statSync(resolved);
  if (stats.size > MAX_READ_SIZE)
    return respond(false, null, `File too large: ${stats.size} bytes (max ${MAX_READ_SIZE})`);

  log(agentId, 'DEBUG', `readRaw: ${resolved} (${stats.size} bytes)`);

  const buf = fs.readFileSync(resolved);
  const totalBytes = buf.length;
  const byteStart = (start !== undefined) ? Math.max(0, parseInt(start, 10)) : 0;
  const byteEnd   = (end   !== undefined) ? Math.min(parseInt(end, 10), totalBytes - 1) : totalBytes - 1;
  const slice = buf.slice(byteStart, byteEnd + 1);

  const output = {
    path: relRequested,
    totalBytes,
    start: byteStart,
    end: byteEnd,
    truncated: byteEnd < totalBytes - 1,
    content: slice.toString('base64'),
    contentEncoding: 'base64',
  };
  // Convenience: also include decoded text when encoding is requested
  if (encoding) {
    try { output.text = slice.toString(encoding); } catch { /* ignore */ }
  }

  respond(true, output, null, {
    size: stats.size, mtime: stats.mtime.toISOString(),
  });
}

async function handleDeleteFile(params, workspaceRoot, agentId) {
  const { path: filePath } = params;
  if (!filePath) return respond(false, null, 'Missing required param: path');
  const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
  let resolved;
  if (path.isAbsolute(filePath)) {
    resolved = path.resolve(filePath);
    try { if (fileExists(resolved)) resolved = fs.realpathSync(resolved); } catch (e) {}
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
    }
  } else {
    const { safe, resolved: r, error } = resolveSafePath(filePath, workspaceRoot);
    if (!safe) return respond(false, null, error);
    resolved = r;
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
    }
  }

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
  const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
  let resolved;
  if (path.isAbsolute(dirPath)) {
    resolved = path.resolve(dirPath);
    try { if (fileExists(resolved)) resolved = fs.realpathSync(resolved); } catch (e) {}
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${dirPath}`);
    }
  } else {
    const { safe, resolved: r, error } = resolveSafePath(dirPath, workspaceRoot);
    if (!safe) return respond(false, null, error);
    resolved = r;
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${dirPath}`);
    }
  }

  const relRequested = toRelativePosix(resolved, workspaceRoot);
  if (!fs.existsSync(resolved)) {
    return respond(false, { path: relRequested }, `Directory not found: ${relRequested}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return respond(false, { path: relRequested }, `Not a directory: ${relRequested}`);
  }

  log(agentId, 'DEBUG', `listDirectory: ${resolved}`);

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
  const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
  let resolved;
  if (path.isAbsolute(filePath)) {
    resolved = path.resolve(filePath);
    try { if (fileExists(resolved)) resolved = fs.realpathSync(resolved); } catch (e) {}
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
    }
  } else {
    const { safe, resolved: r, error } = resolveSafePath(filePath, workspaceRoot);
    if (!safe) return respond(false, null, error);
    resolved = r;
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
    }
  }
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

// Return the canonicalized allowedPaths entries for the current agent/workspace
async function handleGetAllowedPaths(params, workspaceRoot, agentId) {
  try {
    const allowed = loadAllowedPathsConfig(agentId, workspaceRoot) || [];
    const normalizedRoot = path.resolve(workspaceRoot);
    const items = allowed.map((p) => {
      const item = { selected: true, realpath: p };
      try {
        const stat = fs.statSync(p);
        item.isDirectory = stat.isDirectory();
        if (stat.isFile()) item.sizeBytes = stat.size;
      } catch (e) {
        item.isDirectory = false;
      }
      try {
        if (p === normalizedRoot || p.startsWith(normalizedRoot + path.sep)) {
          item.relpath = toRelativePosix(p, workspaceRoot);
        }
      } catch (e) { /* ignore */ }
      return item;
    });

    respond(true, { allowedPaths: items }, null);
  } catch (err) {
    respond(false, null, `Failed to load allowed paths: ${err.message}`);
  }
}

// Check existence of a path (file or directory). Returns canonical info.
async function handleExists(params, workspaceRoot, agentId) {
  try {
    const { path: target } = params;
    if (!target) return respond(false, null, 'Missing required param: path');

    const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
    let resolved;
    if (path.isAbsolute(target)) {
      resolved = path.resolve(target);
      try { if (fileExists(resolved)) resolved = fs.realpathSync(resolved); } catch (e) {}
      if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
        return respond(false, null, `Access denied by allowedPaths policy: ${target}`);
      }
    } else {
      const { safe, resolved: r, error } = resolveSafePath(target, workspaceRoot);
      if (!safe) return respond(false, null, error);
      resolved = r;
      if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
        return respond(false, null, `Access denied by allowedPaths policy: ${target}`);
      }
    }

    const exists = fs.existsSync(resolved);
    if (!exists) {
      const rel = toRelativePosix(resolved, workspaceRoot);
      return respond(true, { exists: false, realpath: resolved, relpath: rel }, null);
    }

    const stat = fs.statSync(resolved);
    const item = {
      exists: true,
      realpath: resolved,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
    };
    if (stat.isFile()) item.sizeBytes = stat.size;
    try {
      if (resolved === path.resolve(workspaceRoot) || resolved.startsWith(path.resolve(workspaceRoot) + path.sep)) {
        item.relpath = toRelativePosix(resolved, workspaceRoot);
      }
    } catch (e) {}

    respond(true, item, null);
  } catch (err) {
    respond(false, null, `exists check failed: ${err.message}`);
  }
}

// ─── New filesystem handlers ─────────────────────────────────────────────────

function resolveAndCheckPath(filePath, workspaceRoot, agentId) {
  const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
  let resolved;
  if (path.isAbsolute(filePath)) {
    resolved = path.resolve(filePath);
    try { if (fileExists(resolved)) resolved = fs.realpathSync(resolved); } catch (e) {}
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot))
      return { resolved: null, error: `Access denied by allowedPaths policy: ${filePath}` };
  } else {
    const { safe, resolved: r, error } = resolveSafePath(filePath, workspaceRoot);
    if (!safe) return { resolved: null, error };
    resolved = r;
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot))
      return { resolved: null, error: `Access denied by allowedPaths policy: ${filePath}` };
  }
  return { resolved, error: null };
}

async function handleCopyFile(params, workspaceRoot, agentId) {
  const { src, dest } = params || {};
  if (!src) return respond(false, null, 'Missing required param: src');
  if (!dest) return respond(false, null, 'Missing required param: dest');
  const { resolved: srcR, error: e1 } = resolveAndCheckPath(src, workspaceRoot, agentId);
  if (e1) return respond(false, null, e1);
  const destAbs = path.isAbsolute(dest) ? path.resolve(dest) : path.resolve(workspaceRoot, dest);
  const { resolved: destR, error: e2 } = resolveAndCheckPath(dest, workspaceRoot, agentId);
  if (e2) return respond(false, null, e2);
  if (!fs.existsSync(srcR)) return respond(false, null, `Source not found: ${src}`);
  ensureDirSync(path.dirname(destR));
  fs.copyFileSync(srcR, destR);
  log(agentId, 'INFO', `copyFile: ${srcR} -> ${destR}`);
  const stats = fs.statSync(destR);
  respond(true, { src: toRelativePosix(srcR, workspaceRoot), dest: toRelativePosix(destR, workspaceRoot), size: stats.size }, null, {});
}

async function handleMoveFile(params, workspaceRoot, agentId) {
  const { src, dest } = params || {};
  if (!src) return respond(false, null, 'Missing required param: src');
  if (!dest) return respond(false, null, 'Missing required param: dest');
  const { resolved: srcR, error: e1 } = resolveAndCheckPath(src, workspaceRoot, agentId);
  if (e1) return respond(false, null, e1);
  const { resolved: destR, error: e2 } = resolveAndCheckPath(dest, workspaceRoot, agentId);
  if (e2) return respond(false, null, e2);
  if (!fs.existsSync(srcR)) return respond(false, null, `Source not found: ${src}`);
  ensureDirSync(path.dirname(destR));
  fs.renameSync(srcR, destR);
  log(agentId, 'INFO', `moveFile: ${srcR} -> ${destR}`);
  respond(true, { src: toRelativePosix(srcR, workspaceRoot), dest: toRelativePosix(destR, workspaceRoot), moved: true }, null, {});
}

async function handleCreateDirectory(params, workspaceRoot, agentId) {
  const { path: dirPath } = params || {};
  if (!dirPath) return respond(false, null, 'Missing required param: path');
  const { resolved, error } = resolveAndCheckPath(dirPath, workspaceRoot, agentId);
  if (error) return respond(false, null, error);
  if (fs.existsSync(resolved)) {
    const s = fs.statSync(resolved);
    if (s.isDirectory()) return respond(true, { path: toRelativePosix(resolved, workspaceRoot), created: false, alreadyExists: true }, null, {});
    return respond(false, null, `Path exists and is not a directory: ${dirPath}`);
  }
  fs.mkdirSync(resolved, { recursive: true });
  log(agentId, 'INFO', `createDirectory: ${resolved}`);
  respond(true, { path: toRelativePosix(resolved, workspaceRoot), created: true }, null, {});
}

async function handleDeleteDirectory(params, workspaceRoot, agentId) {
  const { path: dirPath, recursive = false, confirm = false } = params || {};
  if (!dirPath) return respond(false, null, 'Missing required param: path');
  if (recursive && !confirm)
    return respond(false, null, 'Recursive directory delete requires confirm:true');
  const { resolved, error } = resolveAndCheckPath(dirPath, workspaceRoot, agentId);
  if (error) return respond(false, null, error);
  if (!fs.existsSync(resolved)) return respond(false, null, `Directory not found: ${dirPath}`);
  const s = fs.statSync(resolved);
  if (!s.isDirectory()) return respond(false, null, `Not a directory: ${dirPath}`);
  fs.rmSync(resolved, { recursive, force: false });
  log(agentId, 'INFO', `deleteDirectory: ${resolved} (recursive=${recursive})`);
  respond(true, { path: toRelativePosix(resolved, workspaceRoot), deleted: true }, null, {});
}

async function handleSetPermissions(params, workspaceRoot, agentId) {
  const { path: filePath, mode } = params || {};
  if (!filePath) return respond(false, null, 'Missing required param: path');
  if (mode === undefined) return respond(false, null, 'Missing required param: mode (octal string, e.g. "755")');
  const { resolved, error } = resolveAndCheckPath(filePath, workspaceRoot, agentId);
  if (error) return respond(false, null, error);
  if (!fs.existsSync(resolved)) return respond(false, null, `Path not found: ${filePath}`);
  if (process.platform === 'win32') {
    log(agentId, 'WARN', `setPermissions is a no-op on Windows: ${resolved}`);
    return respond(true, { path: toRelativePosix(resolved, workspaceRoot), warning: 'setPermissions is a no-op on Windows' }, null, {});
  }
  const modeInt = parseInt(String(mode), 8);
  fs.chmodSync(resolved, modeInt);
  log(agentId, 'INFO', `setPermissions: ${resolved} mode=${mode}`);
  respond(true, { path: toRelativePosix(resolved, workspaceRoot), mode }, null, {});
}

async function handleGetPermissions(params, workspaceRoot, agentId) {
  const { path: filePath } = params || {};
  if (!filePath) return respond(false, null, 'Missing required param: path');
  const { resolved, error } = resolveAndCheckPath(filePath, workspaceRoot, agentId);
  if (error) return respond(false, null, error);
  if (!fs.existsSync(resolved)) return respond(false, null, `Path not found: ${filePath}`);
  const stats = fs.statSync(resolved);
  const modeOctal = (stats.mode & 0o777).toString(8).padStart(3, '0');
  respond(true, { path: toRelativePosix(resolved, workspaceRoot), mode: modeOctal, modeRaw: stats.mode }, null, {});
}

// ─── Main ───────────────────────────────────────────────────────────────────

const ACTION_MAP = {
  readRaw: handleReadRaw,
  readFile: handleReadRaw,         // legacy alias
  deleteFile: handleDeleteFile,
  listDirectory: handleListDirectory,
  listDir: handleListDirectory,
  listFiles: handleListDirectory,
  list: handleListDirectory,
  stat: handleStat,
  getAllowedPaths: handleGetAllowedPaths,
  exists: handleExists,
  copyFile: handleCopyFile,
  moveFile: handleMoveFile,
  rename: handleMoveFile,
  createDirectory: handleCreateDirectory,
  mkdir: handleCreateDirectory,
  deleteDirectory: handleDeleteDirectory,
  rmdir: handleDeleteDirectory,
  setPermissions: handleSetPermissions,
  getPermissions: handleGetPermissions,
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
