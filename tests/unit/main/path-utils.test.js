const assert = require('assert');
const path = require('path');

const PathUtils = require('../../../src/shared/utils/path-utils');
const fs = require('fs');

function withStubbedExists(stubFn, fn) {
  const original = fs.existsSync;
  fs.existsSync = stubFn;
  try {
    return fn();
  } finally {
    fs.existsSync = original;
  }
}

function normalizeWin(p) {
  return path.normalize(p);
}

describe('PathUtils - basic behavior', () => {
  it('toScormProtocolUrl converts app-rooted file into scorm-app URL', () => {
    const appRoot = normalizeWin('C:\\Users\\svincent\\GitHub\\scorm-tester');
    const filePath = normalizeWin('C:\\Users\\svincent\\GitHub\\scorm-tester\\index.html');
    const url = PathUtils.toScormProtocolUrl(filePath, appRoot);
    assert.strictEqual(url, 'scorm-app://index.html');
  });

  it('handleProtocolRequest resolves appRoot-relative URL', () => {
    const appRoot = normalizeWin('C:\\Users\\svincent\\GitHub\\scorm-tester');
    const protocolUrl = 'scorm-app://src/renderer/app.js';
    const expectedResolved = normalizeWin(path.join(appRoot, 'src/renderer/app.js'));

    const result = withStubbedExists(p => true, () => PathUtils.handleProtocolRequest(protocolUrl, appRoot));
    assert.strictEqual(result.success, true, 'expected success for appRoot-relative path');
    assert.strictEqual(normalizeWin(result.resolvedPath), expectedResolved);
    assert.strictEqual(result.usedBase, 'appRoot');
  });

  it('handleProtocolRequest accepts abs path encoded with pipe (C|/) and percent-encoded form (C%7C/)', () => {
    const appRoot = normalizeWin('C:\\approot-should-not-be-used');
    const encodedPipe = 'scorm-app://abs/C%7C/Users/svincent/AppData/Local/Temp/scorm-tester/scorm_123/index_lms.html';
    const expected = normalizeWin('C:\\Users\\svincent\\AppData\\Local\\Temp\\scorm-tester\\scorm_123\\index_lms.html');

    const result = withStubbedExists((p) => {
      const normalized = path.normalize(p);
      return normalized === expected;
    }, () => PathUtils.handleProtocolRequest(encodedPipe, appRoot));

    assert.strictEqual(result.success, true, 'expected success for encoded abs path');
    assert.strictEqual(path.normalize(result.resolvedPath), expected);
    assert.strictEqual(result.usedBase, 'allowedBase');
  });

  it('handleProtocolRequest returns triedCandidates and fails when abs path not found', () => {
    const appRoot = normalizeWin('C:\\approot-should-not-be-used');
    const encodedPipe = 'scorm-app://abs/C%7C/Users/svincent/AppData/Local/Temp/scorm-tester/scorm_404/missing.js';

    const result = withStubbedExists(() => false, () => PathUtils.handleProtocolRequest(encodedPipe, appRoot));
    assert.strictEqual(result.success, false, 'expected failure when file missing');
    assert.ok(Array.isArray(result.triedCandidates) && result.triedCandidates.length > 0, 'expected triedCandidates to be present');
    assert.strictEqual(result.error, 'Invalid or inaccessible path');
  });

  it('handleProtocolRequest detects undefined path and returns isUndefinedPath=true', () => {
    const appRoot = normalizeWin('C:\\something');
    const result = PathUtils.handleProtocolRequest('scorm-app:///undefined/path', appRoot);
    assert.strictEqual(result.isUndefinedPath, true);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.includes('Undefined path'), true);
  });
});