"use strict";

const fs = require("fs");
const path = require("path");
const ManifestParser = require("../../main/services/scorm/cam/manifest-parser");
const sessions = require("../session");
function ensureManifestPath(workspacePath) {
  if (!workspacePath || typeof workspacePath !== "string") {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }
  const manifestPath = path.join(path.resolve(workspacePath), "imsmanifest.xml");
  if (!fs.existsSync(manifestPath)) {
    const e = new Error(`imsmanifest.xml not found in ${workspacePath}`);
    e.name = "ParserError";
    e.code = "MANIFEST_NOT_FOUND";
    throw e;
  }
  return manifestPath;
}

async function scorm_lint_manifest(params = {}) {
  let manifestPath;
  try {
    manifestPath = ensureManifestPath(params.workspace_path);
  } catch (error) {
    return {
      valid: false,
      scorm_version: null,
      errors: [error?.message || String(error)],
      warnings: []
    };
  }

  const parser = new ManifestParser({
    setError: () => {}
  });

  try {
    const result = await parser.parseManifestFile(manifestPath);
    // Basic success shape; future: include detailed validation results
    return {
      valid: true,
      scorm_version: result?.schemaversion || null,
      errors: [],
      warnings: []
    };
  } catch (error) {
    return {
      valid: false,
      scorm_version: null,
      errors: [error?.message || String(error)],
      warnings: []
    };
  }
}

function listFilesRecursive(baseDir) {
  const result = [];
  const stack = [baseDir];
  const base = path.resolve(baseDir);
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(current, ent.name);
      const resolved = path.resolve(p);
      if (!resolved.startsWith(base)) continue; // boundary guard
      if (ent.isDirectory()) {
        stack.push(resolved);
      } else if (ent.isFile()) {
        result.push(resolved);
      }
    }
  }
  return result;
}

async function scorm_lint_api_usage(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }
  const files = listFilesRecursive(workspace).filter(f => /\.(html?|js)$/i.test(f));

  const issues = [];
  const scanned_files = files.map(f => path.relative(workspace, f));

  for (const file of files) {
    let content = "";
    try { content = fs.readFileSync(file, "utf8"); } catch (_) { continue; }

    const hasInitialize = /\b(API_1484_11\.)?Initialize\s*\(/.test(content);
    const setValueMatches = content.match(/\b(API_1484_11\.)?SetValue\s*\(/g) || [];
    const getValueMatches = content.match(/\b(API_1484_11\.)?GetValue\s*\(/g) || [];

    // Compute basic line numbers for first occurrence hints
    const lines = content.split(/\r?\n/);
    let firstApiLine = null; let lastApiLine = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/(API_1484_11\.)?SetValue\s*\(|(API_1484_11\.)?GetValue\s*\(/.test(line)) {
        if (firstApiLine === null) firstApiLine = i + 1;
        lastApiLine = i + 1;
      }
    }

    if (!hasInitialize && (setValueMatches.length > 0 || getValueMatches.length > 0)) {
      issues.push({
        file: path.relative(workspace, file),
        line: firstApiLine || undefined,
        issue: "Missing Initialize() before SCORM API calls",
        fix_suggestion: "Call API_1484_11.Initialize(\"\") before SetValue/GetValue",
      });
    }

    const hasTerminate = /\b(API_1484_11\.)?Terminate\s*\(/.test(content);
    if ((setValueMatches.length > 0 || getValueMatches.length > 0) && !hasTerminate) {
      issues.push({
        file: path.relative(workspace, file),
        line: lastApiLine || undefined,
        issue: "Missing Terminate() to close SCORM session",
        fix_suggestion: "Ensure API_1484_11.Terminate(\"\") is called when done",
      });
    }
  }

  return { scanned_files, issues };
}

async function scorm_lint_parent_dom_access(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }
  const files = listFilesRecursive(workspace).filter(f => /\.(html?|js|css)$/i.test(f));

  const violations = [];
  const scanned_files = files.map(f => path.relative(workspace, f));

  // JavaScript patterns that indicate parent DOM manipulation (violations)
  const jsViolationPatterns = [
    {
      pattern: /\bparent\.document\b(?!\.API)(?!\.API_1484_11)/g,
      message: "Accesses parent.document (parent window DOM)",
      severity: "error"
    },
    {
      pattern: /\bwindow\.parent\.document\b(?!\.API)(?!\.API_1484_11)/g,
      message: "Accesses window.parent.document (parent window DOM)",
      severity: "error"
    },
    {
      pattern: /\btop\.document\b(?!\.API)(?!\.API_1484_11)/g,
      message: "Accesses top.document (top window DOM)",
      severity: "error"
    },
    {
      pattern: /\bwindow\.top\.document\b(?!\.API)(?!\.API_1484_11)/g,
      message: "Accesses window.top.document (top window DOM)",
      severity: "error"
    },
    {
      pattern: /\$\s*\(\s*parent\.document/g,
      message: "Uses jQuery on parent.document",
      severity: "error"
    },
    {
      pattern: /\$\s*\(\s*window\.parent\.document/g,
      message: "Uses jQuery on window.parent.document",
      severity: "error"
    },
    {
      pattern: /\bjQuery\s*\(\s*parent\.document/g,
      message: "Uses jQuery on parent.document",
      severity: "error"
    },
    {
      pattern: /\bparent\.document\.getElementById/g,
      message: "Calls parent.document.getElementById (modifies parent DOM)",
      severity: "error"
    },
    {
      pattern: /\bparent\.document\.querySelector/g,
      message: "Calls parent.document.querySelector (accesses parent DOM)",
      severity: "error"
    },
    {
      pattern: /\bparent\.document\.getElementsBy/g,
      message: "Calls parent.document.getElementsBy* (accesses parent DOM)",
      severity: "error"
    },
    {
      pattern: /\bparent\.document\.body/g,
      message: "Accesses parent.document.body",
      severity: "error"
    },
    {
      pattern: /\bparent\.document\.head/g,
      message: "Accesses parent.document.head",
      severity: "error"
    },
    {
      pattern: /\bparent\.document\.styleSheets/g,
      message: "Accesses parent.document.styleSheets (may inject styles)",
      severity: "warning"
    },
    {
      pattern: /\bparent\.document\.createElement/g,
      message: "Calls parent.document.createElement (may modify parent DOM)",
      severity: "warning"
    }
  ];

  // CSS patterns that can escape iframe boundaries and affect parent window
  const cssViolationPatterns = [
    {
      pattern: /position\s*:\s*fixed/gi,
      message: "Uses position:fixed which escapes iframe boundaries and can overlap parent window UI",
      severity: "warning"
    },
    {
      pattern: /position\s*:\s*sticky/gi,
      message: "Uses position:sticky which can cause layout issues in iframes",
      severity: "info"
    },
    {
      pattern: /height\s*:\s*100vh/gi,
      message: "Uses height:100vh which can cause iframe to expand beyond container and shift parent UI elements",
      severity: "warning"
    },
    {
      pattern: /width\s*:\s*100vw/gi,
      message: "Uses width:100vw which can cause iframe to expand beyond container and shift parent UI elements",
      severity: "warning"
    },
    {
      pattern: /min-height\s*:\s*100vh/gi,
      message: "Uses min-height:100vh which can cause iframe to expand beyond container and shift parent UI elements",
      severity: "warning"
    }
  ];

  for (const file of files) {
    let content = "";
    try { content = fs.readFileSync(file, "utf8"); } catch (_) { continue; }

    const lines = content.split(/\r?\n/);
    const relPath = path.relative(workspace, file);
    const ext = path.extname(file).toLowerCase();

    // Choose patterns based on file type
    const patterns = (ext === '.css') ? cssViolationPatterns : jsViolationPatterns;

    // Generate fix suggestion based on violation type
    const getFixSuggestion = (violationMessage) => {
      if (violationMessage.includes('position:fixed')) {
        return "Replace position:fixed with position:absolute. Fixed positioning in same-origin iframes can escape iframe boundaries and overlap parent window UI elements.";
      } else if (violationMessage.includes('position:sticky')) {
        return "Replace position:sticky with position:absolute or relative. Sticky positioning can cause layout issues in iframes.";
      } else if (violationMessage.includes('100vh') || violationMessage.includes('100vw')) {
        return "Avoid using 100vh/100vw on root elements in SCORM content. Use percentage-based heights (100%) or max-height instead to prevent iframe expansion issues.";
      } else {
        return "SCORM content should only access parent.API or parent.API_1484_11 for API discovery. Remove all parent window DOM manipulation.";
      }
    };

    for (const { pattern, message, severity } of patterns) {
      // Reset regex state
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        // Find line number
        let lineNumber = 1;
        let charCount = 0;
        for (let i = 0; i < lines.length; i++) {
          charCount += lines[i].length + 1; // +1 for newline
          if (charCount > match.index) {
            lineNumber = i + 1;
            break;
          }
        }

        // Get code snippet (the line where violation occurs)
        const codeLine = lines[lineNumber - 1] || "";
        const trimmedLine = codeLine.trim();

        // Truncate long code snippets (e.g., minified files) to keep UI readable
        const MAX_SNIPPET_LENGTH = 200;
        let codeSnippet = trimmedLine;

        if (trimmedLine.length > MAX_SNIPPET_LENGTH) {
          // Find the position of the match within the line
          const lineStartIndex = lines.slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0);
          const matchPositionInLine = match.index - lineStartIndex;

          // Extract context around the match
          const contextBefore = 50;
          const contextAfter = MAX_SNIPPET_LENGTH - contextBefore - 20; // Reserve space for ellipsis

          const start = Math.max(0, matchPositionInLine - contextBefore);
          const end = Math.min(trimmedLine.length, matchPositionInLine + match[0].length + contextAfter);

          const prefix = start > 0 ? '...' : '';
          const suffix = end < trimmedLine.length ? '...' : '';

          codeSnippet = prefix + trimmedLine.substring(start, end) + suffix;
        }

        violations.push({
          file: relPath,
          line: lineNumber,
          severity: severity,
          issue: message,
          code_snippet: codeSnippet,
          fix_suggestion: getFixSuggestion(message)
        });
      }
    }
  }

  return { scanned_files, violations };
}

async function scorm_validate_workspace(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }

  const manifestResult = await scorm_lint_manifest({ workspace_path: workspace });
  const apiUsage = await scorm_lint_api_usage({ workspace_path: workspace, scan_depth: params.scan_depth, api_version: params.api_version });
  const parentDomAccess = await scorm_lint_parent_dom_access({ workspace_path: workspace });

  // simple scoring: start 100, minus 25 per manifest error, minus 10 per api issue, minus 15 per parent DOM violation (cap at 0)
  const manifestErrorCount = Array.isArray(manifestResult.errors) ? manifestResult.errors.length : 0;
  const apiIssueCount = Array.isArray(apiUsage.issues) ? apiUsage.issues.length : 0;
  const parentDomViolationCount = Array.isArray(parentDomAccess.violations) ? parentDomAccess.violations.length : 0;
  let compliance_score = 100 - 25 * manifestErrorCount - 10 * apiIssueCount - 15 * parentDomViolationCount;
  if (compliance_score < 0) compliance_score = 0;

  const actionable_fixes = [];
  if (!manifestResult.valid) actionable_fixes.push("Fix imsmanifest.xml parsing/structure issues");
  if (apiIssueCount > 0) actionable_fixes.push("Initialize API before calling SetValue/GetValue and Terminate when done");
  if (parentDomViolationCount > 0) actionable_fixes.push("Remove parent window DOM access - SCORM content should only access parent.API or parent.API_1484_11");

  const validation_results = {
    manifest: {
      valid: !!manifestResult.valid,
      errors: manifestResult.errors || [],
      warnings: manifestResult.warnings || []
    },
    api_usage: {
      scanned_files: apiUsage.scanned_files,
      issues: apiUsage.issues
    },
    parent_dom_access: {
      scanned_files: parentDomAccess.scanned_files,
      violations: parentDomAccess.violations
    }
  };

  return { validation_results, compliance_score, actionable_fixes };
}

// Simple static sequencing lint: identify leaf items without identifierref
async function scorm_lint_sequencing(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }
  const manifestPath = path.join(workspace, "imsmanifest.xml");
  if (!fs.existsSync(manifestPath)) {
    const e = new Error("imsmanifest.xml not found");
    e.code = "MCP_MANIFEST_NOT_FOUND";
    throw e;
  }
  // Use ManifestParser to extract organizations/items
  const parser = new ManifestParser({ setError: () => {} });
  const result = await parser.parseManifestFile(manifestPath);
  const orgs = result.organizations || {};
  const defaultOrgId = orgs.default || (orgs.organization && orgs.organization[0]?.identifier) || null;
  const org = (orgs.organization || []).find(o => o.identifier === defaultOrgId) || (orgs.organization || [])[0] || null;

  const issues = [];
  let itemsScanned = 0;

  function walk(items, ancestry = []) {
    for (const item of items || []) {
      itemsScanned++;
      const pathStr = [...ancestry, item.identifier || item.title || "item"].join("/");
      const hasChildren = Array.isArray(item.children) && item.children.length > 0;
      const isLeaf = !hasChildren;
      if (isLeaf && !item.identifierref) {
        issues.push({
          rule: "leaf_without_identifierref",
          severity: "warning",
          item_identifier: item.identifier || null,
          path: pathStr,
          issue: "Leaf item missing identifierref (no launchable resource)",
          fix_suggestion: "Provide identifierref to a <resource> or make this a non-leaf node with children.",
        });
      }
      if (hasChildren) walk(item.children, [...ancestry, item.identifier || item.title || "item"]);
    }
  }

  if (org) walk(org.items || [], [org.identifier || "organization"]);

  return {
    issues,
    stats: { itemsScanned, organizations: (orgs.organization || []).length, defaultOrganization: org?.identifier || null }
  };
}

// Aggregate compliance validation (V1 minimal): combine lints and compute a score
async function scorm_validate_compliance(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }

  const [manifestRes, apiRes, seqRes] = await Promise.all([
    scorm_lint_manifest({ workspace_path: workspace }),
    scorm_lint_api_usage({ workspace_path: workspace }),
    scorm_lint_sequencing({ workspace_path: workspace })
  ]);

  const errors = [];
  const warnings = [];
  const suggestions = [];

  if (!manifestRes.valid) {
    for (const err of (manifestRes.errors || [])) {
      errors.push({ category: "manifest", message: err.message || String(err) });
    }
  }

  for (const issue of (apiRes.issues || [])) {
    warnings.push({ category: "api_usage", message: issue.issue, file: issue.file, line: issue.line });
    if (issue.fix_suggestion) suggestions.push(issue.fix_suggestion);
  }

  for (const sissue of (seqRes.issues || [])) {
    warnings.push({ category: "sequencing", message: sissue.issue, path: sissue.path });
    if (sissue.fix_suggestion) suggestions.push(sissue.fix_suggestion);
  }

  // Simple scoring heuristic
  let score = 100;
  score -= (errors.length * 20);
  score -= (apiRes.issues?.length || 0) * 5;
  score -= (seqRes.issues?.length || 0) * 5;
  if (score < 0) score = 0;

  const report = {
    score,
    errors,
    warnings,
    suggestions: Array.from(new Set(suggestions)),
    details: {
      manifest: { valid: manifestRes.valid, errorCount: (manifestRes.errors || []).length },
      api_usage: { files: apiRes.scanned_files?.length || 0, issues: apiRes.issues?.length || 0 },
      sequencing: { issues: seqRes.issues?.length || 0, itemsScanned: seqRes.stats?.itemsScanned || 0 }
    }
  };

  return {
    compliance_score: score,
    errors,
    warnings,
    suggestions: report.suggestions,
    validation_report: JSON.stringify(report)
  };
}


// Aggregate a high-level report by leveraging compliance validation
async function scorm_report(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }
  const compliance = await scorm_validate_compliance({ workspace_path: workspace });
  const desired = String(params.format || 'json').toLowerCase();
  const format = (desired === 'html') ? 'html' : 'json';

  if (format === 'html') {
    let obj = {};
    try { obj = JSON.parse(compliance.validation_report || '{}'); } catch (_) { /* intentionally empty */ }
    const html = [
      '<!doctype html>','<html>','<head>',
      '<meta charset="utf-8"/>',
      '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
      '<title>SCORM Compliance Report</title>',
      '<style>body{font-family:system-ui,Arial,sans-serif;margin:20px;}h1{font-size:20px;}section{margin-top:16px;}code{background:#f5f5f5;padding:2px 4px;border-radius:3px;}</style>',
      '</head>','<body>',
      '<h1>SCORM Compliance Report</h1>',
      `<p><strong>Score:</strong> ${Number(compliance.compliance_score || obj.score || 0)}</p>`,
      '<section><h2>Errors</h2><ul>',
      ...(Array.isArray(obj.errors) ? obj.errors.map(e => `<li>${(e && (e.message || e))}</li>`) : []),
      '</ul></section>',
      '<section><h2>Warnings</h2><ul>',
      ...(Array.isArray(obj.warnings) ? obj.warnings.map(w => `<li>${(w && (w.message || w))}</li>`) : []),
      '</ul></section>',
      '<section><h2>Suggestions</h2><ul>',
      ...(Array.isArray(obj.suggestions) ? obj.suggestions.map(s => `<li>${s}</li>`) : []),
      '</ul></section>',
      '</body></html>'
    ].join('');

    let artifact_path = null;
    const session_id = params.session_id || null;
    if (session_id && sessions && sessions.sessions && sessions.sessions.get(session_id)) {
      const s = sessions.sessions.get(session_id);
      try {
        const outPath = path.join(s.workspace, 'scorm_report.html');
        fs.writeFileSync(outPath, html, 'utf8');
        sessions.addArtifact({ session_id, artifact: { type: 'report', path: outPath } });
        artifact_path = outPath;
      } catch (_) { /* intentionally empty */ }
    }

    return { format: 'html', report: html, compliance_score: compliance.compliance_score, artifact_path };
  }

  // Default JSON
  return {
    format: 'json',
    report: compliance.validation_report,
    compliance_score: compliance.compliance_score
  };
}


module.exports = { scorm_lint_manifest, scorm_lint_api_usage, scorm_lint_parent_dom_access, scorm_validate_workspace, scorm_lint_sequencing, scorm_validate_compliance, scorm_report };

