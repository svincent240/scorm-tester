const path = require('path');

// Mock RuntimeManager before requiring the tool
jest.mock('../../../src/mcp/runtime-manager', () => ({
  RuntimeManager: {
    getPersistent: jest.fn(),
    getNetworkRequests: jest.fn(),
    getRuntimeStatus: jest.fn()
  }
}));

const { RuntimeManager } = require('../../../src/mcp/runtime-manager');
const { scorm_get_network_requests } = require('../../../src/mcp/tools/runtime');

describe('scorm_get_network_requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('requires session_id parameter', async () => {
    await expect(scorm_get_network_requests({})).rejects.toThrow('session_id is required');
    await expect(scorm_get_network_requests({})).rejects.toMatchObject({ code: 'MCP_INVALID_PARAMS' });
  });

  test('throws error if runtime not open', async () => {
    RuntimeManager.getRuntimeStatus.mockResolvedValue({ open: false });

    await expect(scorm_get_network_requests({ session_id: 'test-session' }))
      .rejects.toThrow('Runtime not open');
    await expect(scorm_get_network_requests({ session_id: 'test-session' }))
      .rejects.toMatchObject({ code: 'RUNTIME_NOT_OPEN' });
  });

  test('returns network requests for session', async () => {
    const mockWin = { webContents: {} };
    RuntimeManager.getRuntimeStatus.mockResolvedValue({ open: true });
    RuntimeManager.getPersistent.mockReturnValue(mockWin);
    
    const mockRequests = [
      {
        id: 1,
        timestamp: Date.now() - 1000,
        method: 'GET',
        url: 'https://example.com/api/data',
        resourceType: 'xhr',
        statusCode: 200
      },
      {
        id: 2,
        timestamp: Date.now() - 500,
        method: 'POST',
        url: 'https://example.com/api/submit',
        resourceType: 'fetch',
        statusCode: 201
      }
    ];
    
    RuntimeManager.getNetworkRequests.mockReturnValue(mockRequests);

    const result = await scorm_get_network_requests({ session_id: 'test-session' });

    expect(result).toEqual({
      session_id: 'test-session',
      request_count: 2,
      requests: mockRequests
    });
    expect(RuntimeManager.getNetworkRequests).toHaveBeenCalledWith('test-session', {
      resource_types: null,
      since_ts: null,
      max_count: null
    });
  });

  test('supports filtering by resource types', async () => {
    const mockWin = { webContents: {} };
    RuntimeManager.getRuntimeStatus.mockResolvedValue({ open: true });
    RuntimeManager.getPersistent.mockReturnValue(mockWin);
    RuntimeManager.getNetworkRequests.mockReturnValue([]);

    await scorm_get_network_requests({ 
      session_id: 'test-session',
      options: {
        resource_types: ['xhr', 'fetch']
      }
    });

    expect(RuntimeManager.getNetworkRequests).toHaveBeenCalledWith('test-session', {
      resource_types: ['xhr', 'fetch'],
      since_ts: null,
      max_count: null
    });
  });

  test('supports filtering by timestamp', async () => {
    const mockWin = { webContents: {} };
    RuntimeManager.getRuntimeStatus.mockResolvedValue({ open: true });
    RuntimeManager.getPersistent.mockReturnValue(mockWin);
    RuntimeManager.getNetworkRequests.mockReturnValue([]);

    const since = Date.now() - 5000;
    await scorm_get_network_requests({ 
      session_id: 'test-session',
      options: {
        since_ts: since
      }
    });

    expect(RuntimeManager.getNetworkRequests).toHaveBeenCalledWith('test-session', {
      resource_types: null,
      since_ts: since,
      max_count: null
    });
  });

  test('supports limiting request count', async () => {
    const mockWin = { webContents: {} };
    RuntimeManager.getRuntimeStatus.mockResolvedValue({ open: true });
    RuntimeManager.getPersistent.mockReturnValue(mockWin);
    RuntimeManager.getNetworkRequests.mockReturnValue([]);

    await scorm_get_network_requests({ 
      session_id: 'test-session',
      options: {
        max_count: 50
      }
    });

    expect(RuntimeManager.getNetworkRequests).toHaveBeenCalledWith('test-session', {
      resource_types: null,
      since_ts: null,
      max_count: 50
    });
  });

  test('returns empty array when no requests captured', async () => {
    const mockWin = { webContents: {} };
    RuntimeManager.getRuntimeStatus.mockResolvedValue({ open: true });
    RuntimeManager.getPersistent.mockReturnValue(mockWin);
    RuntimeManager.getNetworkRequests.mockReturnValue([]);

    const result = await scorm_get_network_requests({ session_id: 'test-session' });

    expect(result).toEqual({
      session_id: 'test-session',
      request_count: 0,
      requests: []
    });
  });

  test('includes failed requests with error information', async () => {
    const mockWin = { webContents: {} };
    RuntimeManager.getRuntimeStatus.mockResolvedValue({ open: true });
    RuntimeManager.getPersistent.mockReturnValue(mockWin);
    
    const mockRequests = [
      {
        id: 1,
        timestamp: Date.now(),
        method: 'GET',
        url: 'https://example.com/missing',
        resourceType: 'xhr',
        error: 'net::ERR_NAME_NOT_RESOLVED',
        errorAt: Date.now()
      }
    ];
    
    RuntimeManager.getNetworkRequests.mockReturnValue(mockRequests);

    const result = await scorm_get_network_requests({ session_id: 'test-session' });

    expect(result.requests[0]).toHaveProperty('error');
    expect(result.requests[0].error).toBe('net::ERR_NAME_NOT_RESOLVED');
  });
});

