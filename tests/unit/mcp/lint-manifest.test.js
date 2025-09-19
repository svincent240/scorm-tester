const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_lint_manifest } = require('../../../src/mcp/tools/validate');

function mktempDir(prefix = 'mcp_lint_') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return base;
}

describe('MCP scorm_lint_manifest', () => {
  let tempCourseDir;

  beforeAll(() => {
    tempCourseDir = mktempDir();
    // minimal manifest
    fs.writeFileSync(path.join(tempCourseDir, 'imsmanifest.xml'), '<manifest/>');
  });

  afterAll(() => {
    try { fs.rmSync(tempCourseDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('returns basic validation structure', async () => {
    const result = await scorm_lint_manifest({ workspace_path: tempCourseDir });
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  test('throws when manifest missing', async () => {
    const emptyDir = mktempDir();
    await expect(scorm_lint_manifest({ workspace_path: emptyDir })).resolves.toEqual(expect.objectContaining({ valid: false }));
    try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch (_) {}
  });
});

