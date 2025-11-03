const { scorm_lint_parent_dom_access } = require('../../../src/mcp/tools/validate');
const fs = require('fs');
const path = require('path');
const os = require('os');

function mktempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scorm-test-'));
}

describe('MCP scorm_lint_parent_dom_access', () => {
  test('detects parent.document access', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'sco.js'), 'var el = parent.document.getElementById("header");');
      
      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });
      
      expect(res).toHaveProperty('scanned_files');
      expect(res).toHaveProperty('violations');
      expect(res.violations.length).toBeGreaterThan(0);
      expect(res.violations[0]).toHaveProperty('file');
      expect(res.violations[0]).toHaveProperty('line');
      expect(res.violations[0]).toHaveProperty('severity');
      expect(res.violations[0]).toHaveProperty('code_snippet');
      expect(res.violations[0].file).toBe('sco.js');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('does not flag parent.API access', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'sco.js'), 'var api = parent.API_1484_11;');
      
      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });
      
      expect(res.violations.length).toBe(0);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('detects jQuery on parent.document', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'sco.js'), '$(parent.document).find(".header");');

      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });

      expect(res.violations.length).toBeGreaterThan(0);
      // The violation should mention either jQuery or parent.document
      const hasRelevantViolation = res.violations.some(v =>
        v.issue.includes('jQuery') || v.issue.includes('parent.document')
      );
      expect(hasRelevantViolation).toBe(true);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('detects multiple violations in same file', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'sco.js'), `
        var el = parent.document.getElementById("header");
        var body = parent.document.body;
        parent.document.querySelector(".test");
      `);
      
      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });
      
      expect(res.violations.length).toBeGreaterThan(2);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('scans HTML files', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'sco.html'), `
        <script>
          var el = parent.document.getElementById("test");
        </script>
      `);
      
      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });
      
      expect(res.violations.length).toBeGreaterThan(0);
      expect(res.violations[0].file).toBe('sco.html');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('returns empty violations for clean course', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'sco.js'), `
        var api = parent.API_1484_11;
        api.Initialize("");
        api.SetValue("cmi.completion_status", "completed");
        api.Terminate("");
      `);

      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });

      expect(res.violations.length).toBe(0);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('detects position:fixed in CSS files', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'styles.css'), `
        .modal {
          position: fixed;
          top: 0;
          left: 0;
        }
      `);

      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });

      expect(res.violations.length).toBeGreaterThan(0);
      expect(res.violations[0].file).toBe('styles.css');
      expect(res.violations[0].severity).toBe('warning');
      expect(res.violations[0].issue).toContain('position:fixed');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('detects position:sticky in CSS files', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'styles.css'), `
        .header {
          position: sticky;
          top: 0;
        }
      `);

      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });

      expect(res.violations.length).toBeGreaterThan(0);
      expect(res.violations[0].file).toBe('styles.css');
      expect(res.violations[0].issue).toContain('position:sticky');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

