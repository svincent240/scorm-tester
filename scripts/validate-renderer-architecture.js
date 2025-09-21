#!/usr/bin/env node
/**
 * Validate Renderer Architecture (Phase 1)
 * - No direct DOM access in components (document.getElementById/querySelector/querySelectorAll)
 * - No direct IPC usage in components (window.electronAPI / global electronAPI)
 * - Prefer central logger; console allowed/blocked by ESLint separately
 *
 * This script is complementary to ESLint rules and provides a quick CI-friendly
 * check that prints clear, concise violations and exits non-zero when found.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.cwd();
const COMPONENTS_DIR = path.join(REPO_ROOT, 'src', 'renderer', 'components');

const DOM_PATTERNS = [
  /document\.(getElementById|querySelector|querySelectorAll)\s*\(/,
];
const IPC_PATTERNS = [
  /window\s*\.\s*electronAPI\b/,
  /\belectronAPI\b/, // global leak
];

/** Collect all .js files under a directory recursively */
function listJsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (entry.isFile() && full.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function checkFile(file) {
  const rel = path.relative(REPO_ROOT, file);
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations = [];

  lines.forEach((line, idx) => {
    // DOM
    for (const re of DOM_PATTERNS) {
      if (re.test(line)) {
        violations.push({
          type: 'no-direct-dom-access',
          file: rel,
          line: idx + 1,
          excerpt: line.trim(),
          suggestion: 'Use BaseComponent.find/findAll or AppManager-managed refs.'
        });
        break;
      }
    }
    // IPC
    for (const re of IPC_PATTERNS) {
      if (re.test(line)) {
        violations.push({
          type: 'no-direct-ipc',
          file: rel,
          line: idx + 1,
          excerpt: line.trim(),
          suggestion: 'Use services (e.g., ScormClient) or AppManager-provided APIs.'
        });
        break;
      }
    }
  });

  return violations;
}

function run() {
  const start = Date.now();
  const componentFiles = listJsFiles(COMPONENTS_DIR);
  let all = [];
  for (const f of componentFiles) {
    all = all.concat(checkFile(f));
  }

  if (all.length === 0) {
    console.log('[validate-renderer-architecture] OK - no violations found');
    console.log(`[validate-renderer-architecture] Checked ${componentFiles.length} files in ${Date.now() - start}ms`);
    process.exit(0);
  }

  console.error('[validate-renderer-architecture] Violations found:');
  for (const v of all) {
    console.error(`- (${v.type}) ${v.file}:${v.line}`);
    console.error(`    ${v.excerpt}`);
    console.error(`    ▶ Suggestion: ${v.suggestion}`);
  }
  console.error(`[validate-renderer-architecture] ${all.length} violation(s) across ${componentFiles.length} file(s).`);
  process.exit(1);
}

run();

