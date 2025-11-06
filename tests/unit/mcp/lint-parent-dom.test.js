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
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
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
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
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
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
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
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
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
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
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
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });

  test('detects position:fixed in CSS files', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'styles.css'), `
        .header {
          position: fixed;
          top: 0;
        }
      `);

      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });

      expect(res.violations.length).toBeGreaterThan(0);
      expect(res.violations[0].severity).toBe('warning');
      expect(res.violations[0].issue).toContain('position:fixed');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });

  test('detects height:100vh in CSS files', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'styles.css'), `
        #app {
          height: 100vh;
        }
      `);

      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });

      expect(res.violations.length).toBeGreaterThan(0);
      expect(res.violations[0].severity).toBe('warning');
      expect(res.violations[0].issue).toContain('100vh');
      expect(res.violations[0].fix_suggestion).toContain('percentage-based heights');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });

  test('detects width:100vw in CSS files', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'styles.css'), `
        body {
          width: 100vw;
        }
      `);

      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });

      expect(res.violations.length).toBeGreaterThan(0);
      expect(res.violations[0].severity).toBe('warning');
      expect(res.violations[0].issue).toContain('100vw');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
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
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
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
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });

  test('truncates long code snippets from minified files', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');

      // Create a minified-style line with violation in the middle
      const longPrefix = 'var a=1,b=2,c=3,d=4,e=5,f=6,g=7,h=8,i=9,j=10,k=11,l=12,m=13,n=14,o=15,p=16,q=17,r=18,s=19,t=20,u=21,v=22,w=23,x=24,y=25,z=26;'.repeat(5);
      const violation = 'var el=parent.document.getElementById("test");';
      const longSuffix = 'var aa=1,bb=2,cc=3,dd=4,ee=5,ff=6,gg=7,hh=8,ii=9,jj=10,kk=11,ll=12,mm=13,nn=14,oo=15,pp=16,qq=17,rr=18,ss=19,tt=20,uu=21,vv=22,ww=23,xx=24,yy=25,zz=26;'.repeat(5);
      const minifiedLine = longPrefix + violation + longSuffix;

      fs.writeFileSync(path.join(dir, 'app.min.js'), minifiedLine);

      const res = await scorm_lint_parent_dom_access({ workspace_path: dir });

      expect(res.violations.length).toBeGreaterThan(0);
      const snippet = res.violations[0].code_snippet;

      // Snippet should be truncated (max 200 chars)
      expect(snippet.length).toBeLessThanOrEqual(210); // Allow some buffer for ellipsis

      // Should contain ellipsis to indicate truncation
      expect(snippet).toMatch(/\.\.\./);

      // Should still contain the violation pattern
      expect(snippet).toContain('parent.document');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });
});

