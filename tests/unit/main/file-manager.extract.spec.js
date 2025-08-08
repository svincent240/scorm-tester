const assert = require('assert');
const path = require('path');
const FileManager = require('../../../src/main/services/file-manager');

jest.mock('node-stream-zip');
jest.mock('fs/promises');

describe('FileManager.extractZipWithValidation (unit tests w/ mocked StreamZip)', function() {
  let fakeEntries;
  let mockExtractedFiles;
  let fm;

  beforeEach(function() {
    fakeEntries = {};
    mockExtractedFiles = [];

    // Clear all mocks before each test
    jest.clearAllMocks();

    // Dynamically set mock implementations in beforeEach
    require('node-stream-zip').async.mockImplementation(() => ({
      entries: jest.fn(async () => fakeEntries),
      extract: jest.fn(async (entryName, targetPath) => {
        mockExtractedFiles.push({ entryName, targetPath });
        console.log('Mock extract called for:', entryName);
        return Promise.resolve();
      }),
      close: jest.fn(async () => Promise.resolve())
    }));

    require('fs/promises').mkdir.mockImplementation(async () => Promise.resolve());
    require('fs/promises').readFile.mockImplementation(async () => Promise.resolve(''));
    require('fs/promises').writeFile.mockImplementation(async () => Promise.resolve(''));

    const { createLoggerSink } = require('../../setup');
    const logger = createLoggerSink();
    fm = new FileManager({ setError: () => {} }, logger, {});
  });

  it('extracts safe entries and skips directories and suspicious names', async function() {
    fakeEntries = {
      'file1.txt': { name: 'file1.txt', isDirectory: false, size: 100 },
      'nested/file2.txt': { name: 'nested/file2.txt', isDirectory: false, size: 200 },
      'assets/': { name: 'assets/', isDirectory: true, size: 0 },
      'evil/../../etc/passwd': { name: 'evil/../../etc/passwd', isDirectory: false, size: 50 },
      'weird~name.bin': { name: 'weird~name.bin', isDirectory: false, size: 30 },
      'another/../traversal.txt': { name: 'another/../traversal.txt', isDirectory: false, size: 40 },
      'C:\\absolute\\path.txt': { name: 'C:\\absolute\\path.txt', isDirectory: false, size: 60 },
      'null\0byte.txt': { name: 'null\0byte.txt', isDirectory: false, size: 70 }
    };

    const extractPath = path.join(__dirname, 'tmp_extract_safe');
    const stats = await fm.extractZipWithValidation('/path/to/fake.zip', extractPath);

    assert.strictEqual(stats.extractedCount, 2, 'expected 2 extracted files');
    assert.strictEqual(stats.skippedCount, 6, 'expected 6 skipped entries');
    assert.strictEqual(stats.totalSize, 100 + 200, 'totalSize should be sum of extracted files');
  });

  it('correctly handles path normalization and prevents directory traversal', async function() {
    fakeEntries = {
      'safe/nested/file.txt': { name: 'safe/nested/file.txt', isDirectory: false, size: 100 },
      'safe\\windows\\path.txt': { name: 'safe\\windows\\path.txt', isDirectory: false, size: 100 },
      '../outside.txt': { name: '../outside.txt', isDirectory: false, size: 50 },
      '/absolute/path.txt': { name: '/absolute/path.txt', isDirectory: false, size: 50 },
      'safe/./file.txt': { name: 'safe/./file.txt', isDirectory: false, size: 100 },
      'safe/../file.txt': { name: 'safe/../file.txt', isDirectory: false, size: 50 },
      'safe/file\0name.txt': { name: 'safe/file\0name.txt', isDirectory: false, size: 50 },
      'safe/file~name.txt': { name: 'safe/file~name.txt', isDirectory: false, size: 50 },
      'dir/': { name: 'dir/', isDirectory: true, size: 0 }
    };

    const extractPath = path.join(__dirname, 'tmp_extract_traversal');
    const resolvedExtractPath = path.resolve(extractPath);

    const stats = await fm.extractZipWithValidation('/path/to/fake.zip', extractPath);

    assert.strictEqual(stats.extractedCount, 3, 'expected 3 extracted files');
    assert.strictEqual(stats.skippedCount, 6, 'expected 6 skipped entries');

    const extractedNames = mockExtractedFiles.map(f => f.entryName);
    assert.ok(extractedNames.includes('safe/nested/file.txt'));
    assert.ok(extractedNames.includes('safe\\windows\\path.txt'));
    assert.ok(extractedNames.includes('safe/./file.txt'));

    for (const extractedFile of mockExtractedFiles) {
      const resolvedTarget = path.resolve(extractedFile.targetPath);
      assert.ok(
        resolvedTarget.startsWith(resolvedExtractPath + path.sep) || resolvedTarget === resolvedExtractPath,
        `Extracted file target path "${resolvedTarget}" should be within "${resolvedExtractPath}"`
      );
    }
  });

  it('throws when totalSize would exceed configured maxExtractedSize', async function() {
    fakeEntries = {};
    fakeEntries['big1.bin'] = { name: 'big1.bin', isDirectory: false, size: 10 * 1024 * 1024 };
    fakeEntries['big2.bin'] = { name: 'big2.bin', isDirectory: false, size: 10 * 1024 * 1024 };

    fm.config.maxExtractedSize = 5 * 1024 * 1024;

    let threw = false;
    try {
      await fm.extractZipWithValidation('/path/to/fake.zip', path.join(__dirname, 'tmp_extract_over'));
    } catch (e) {
      threw = true;
      assert.ok(e.message && e.message.includes('Extracted content would exceed size limit'), 'expected size limit error');
    }
    assert.strictEqual(threw, true, 'expected extractZipWithValidation to throw when size exceeded');
  });
});