const path = require('path');
const fs = require('fs');
const SessionStore = require('../../../src/main/services/session-store');

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/user/data')
  }
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  promises: {
    writeFile: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn()
  }
}));

describe('SessionStore', () => {
  let sessionStore;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    sessionStore = new SessionStore(null, mockLogger);
  });

  describe('initialization', () => {
    it('should create store directory if it does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      await sessionStore.doInitialize();
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('scorm-sessions'), { recursive: true });
    });

    it('should not create store directory if it exists', async () => {
      fs.existsSync.mockReturnValue(true);
      await sessionStore.doInitialize();
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('getFilePath', () => {
    it('should generate correct file path with default namespace', () => {
      const filePath = sessionStore.getFilePath('course-123');
      expect(filePath).toContain('gui_course_123.json');
    });

    it('should generate correct file path with custom namespace', () => {
      const filePath = sessionStore.getFilePath('course-123', 'mcp');
      expect(filePath).toContain('mcp_course_123.json');
    });

    it('should sanitize courseId and namespace', () => {
      const filePath = sessionStore.getFilePath('Course/123!', 'My Namespace');
      expect(filePath).toContain('my_namespace_course_123_.json');
    });
  });

  describe('saveSession', () => {
    it('should save session data to correct file', async () => {
      const data = { cmi: { suspend_data: '123' } };
      await sessionStore.saveSession('course-1', data, 'gui');
      
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('gui_course_1.json'),
        JSON.stringify(data, null, 2),
        'utf8'
      );
    });

    it('should use custom namespace when provided', async () => {
      const data = { foo: 'bar' };
      await sessionStore.saveSession('course-1', data, 'mcp');
      
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('mcp_course_1.json'),
        expect.any(String),
        'utf8'
      );
    });
  });

  describe('loadSession', () => {
    it('should load session data from correct file', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue(JSON.stringify({ loaded: true }));

      const result = await sessionStore.loadSession('course-1', 'gui');
      
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        expect.stringContaining('gui_course_1.json'),
        'utf8'
      );
      expect(result).toEqual({ loaded: true });
    });

    it('should return null if file does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      const result = await sessionStore.loadSession('course-1', 'gui');
      expect(result).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('should delete session file if it exists', async () => {
      fs.existsSync.mockReturnValue(true);
      await sessionStore.deleteSession('course-1', 'gui');
      
      expect(fs.promises.unlink).toHaveBeenCalledWith(
        expect.stringContaining('gui_course_1.json')
      );
    });

    it('should do nothing if file does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      await sessionStore.deleteSession('course-1', 'gui');
      
      expect(fs.promises.unlink).not.toHaveBeenCalled();
    });
  });

  describe('hasSession', () => {
    it('should check existence of correct file', () => {
      sessionStore.hasSession('course-1', 'mcp');
      expect(fs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('mcp_course_1.json')
      );
    });
  });
});
