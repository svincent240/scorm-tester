const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PathUtils = require('../src/shared/utils/path-utils');

function createTempDir() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scorm-tester-test-'));
  return base;
}

function writeFile(dir, relPath, content = '') {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

function runTests() {
  const results = [];

  // Test 1: toScormProtocolUrl for appRoot-relative file
  const tempRoot = createTempDir();
  const fileRel = path.join('assets', 'index.html');
  const fileFull = writeFile(tempRoot, fileRel, '<html></html>');

  const protoUrl = PathUtils.toScormProtocolUrl(fileFull, tempRoot);
  results.push({ test: 'toScormProtocolUrl returns scorm-app url', protoUrl });
  assert(protoUrl.startsWith('scorm-app://'));
  assert(protoUrl.indexOf('assets') !== -1, 'Relative path should include assets segment');

  // Test 2: handleProtocolRequest for appRoot-relative path
  const requestUrl = protoUrl; // already in scorm-app:// format
  const res = PathUtils.handleProtocolRequest(requestUrl, tempRoot);
  results.push({ test: 'handleProtocolRequest resolves appRoot-relative path', res });
  assert(res.success === true, 'Expected success for appRoot-relative request');
  assert(res.resolvedPath === PathUtils.normalize(fileFull), `Resolved path should match fileFull (${res.resolvedPath})`);

  // Test 3: handleProtocolRequest for encoded absolute path (abs/ branch)
  const extDir = createTempDir();
  const absFile = writeFile(extDir, 'launch.html', '<html>launch</html>');
  // Encode absolute path into scorm-app://abs/ format (PathUtils expects drive encoded as C|/ for Windows)
  const absForProto = PathUtils.normalize(absFile).replace(/^([A-Za-z]):\//, (_m, d) => `${d}|/`);
  // Note: handleProtocolRequest will attempt decodeURIComponent; avoid double-encoding
  const protoAbsUrl = `scorm-app://abs/${absForProto}`;
  const resAbs = PathUtils.handleProtocolRequest(protoAbsUrl, tempRoot);
  results.push({ test: 'handleProtocolRequest resolves abs absolute path', protoAbsUrl, resAbs });
  assert(resAbs.success === true, 'Expected success for abs encoded absolute path');
  // Normalize both sides before comparison to handle platform-specific separators
  assert(PathUtils.normalize(resAbs.resolvedPath) === PathUtils.normalize(absFile), 'Resolved path should match absolute file path');

  // Test 4: handleProtocolRequest returns undefined path error when '/undefined' present
  const undefinedUrl = 'scorm-app://temp/undefined/something.html';
  const resU = PathUtils.handleProtocolRequest(undefinedUrl, tempRoot);
  results.push({ test: 'handleProtocolRequest detects undefined path', resU });
  assert(resU.success === false && resU.isUndefinedPath === true, 'Expected undefined path detection');

  // Test 5: validatePath prevents traversal
  const bad = PathUtils.validatePath(path.join(tempRoot, '..', '..', 'etc', 'passwd'), tempRoot);
  results.push({ test: 'validatePath blocks traversal', bad });
  assert(bad === false, 'Expected traversal to be blocked');

  // All tests passed
  console.log(JSON.stringify({ ok: true, results }, null, 2));
  return 0;
}

try {
  const code = runTests();
  process.exit(code);
} catch (e) {
  console.error('Test failure:', e);
  process.exit(2);
}