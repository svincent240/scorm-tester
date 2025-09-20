const fs = require('fs');
const path = require('path');
const os = require('os');

const PathUtils = require('../../../src/shared/utils/path-utils');

describe('PathUtils security', () => {
  const appRoot = path.resolve(__dirname, '../../../');
  const tempRoot = PathUtils.getTempRoot();

  beforeAll(() => {
    // Ensure temp root exists
    if (!fs.existsSync(tempRoot)) fs.mkdirSync(tempRoot, { recursive: true });
  });

  afterAll(() => {
    // Cleanup any test directories we created under temp root
    try {
      const entries = fs.readdirSync(tempRoot);
      for (const e of entries) {
        if (e.startsWith('jest_pathutils_')) {
          fs.rmSync(path.join(tempRoot, e), { recursive: true, force: true });
        }
      }
    } catch (err) {
      // Best-effort cleanup in tests
      // eslint-disable-next-line no-console
      console.warn('cleanup failed:', err && err.message);
    }
  });

  test('toScormProtocolUrl throws if path is outside appRoot', () => {
    const outsidePath = path.join(os.tmpdir(), 'not-app-root', 'file.html');
    expect(() => PathUtils.toScormProtocolUrl(outsidePath, appRoot)).toThrow(/outside app root/i);
  });

  test('handleProtocolRequest blocks traversal and missing files', () => {
    const traversalUrl = 'scorm-app://app/../../etc/passwd';
    const result = PathUtils.handleProtocolRequest(traversalUrl, appRoot);
    expect(result.success).toBe(false);
  });

  test('resolveScormContentUrl succeeds for file under canonical temp root', () => {
    const dir = path.join(tempRoot, 'jest_pathutils_course');
    const manifestDir = dir; // manifest at root
    const file = path.join(dir, 'index.html');

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest></manifest>');
    fs.writeFileSync(file, '<html>ok</html>');

    const res = PathUtils.resolveScormContentUrl(
      'index.html',
      dir,
      path.join(manifestDir, 'imsmanifest.xml'),
      appRoot
    );

    expect(res.success).toBe(true);
    expect(res.url.startsWith('scorm-app://app/')).toBe(true);
    expect(res.usedBase).toBe('tempRoot');
  });
});

