/**
 * MCP Viewport Control Tests
 * 
 * Tests the scorm_set_viewport_size MCP tool
 */

const { spawn } = require('child_process');
const path = require('path');

describe('MCP Viewport Control', () => {
  let mcpProcess;
  let messageId = 1;

  beforeAll(() => {
    // Start MCP server
    const mcpPath = path.join(__dirname, '../src/mcp/node-bridge.js');
    mcpProcess = spawn('node', [mcpPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, SCORM_TESTER_LOG_DIR: path.join(__dirname, '../logs/mcp') }
    });
  });

  afterAll(async () => {
    if (mcpProcess) {
      mcpProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  function sendMCPRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = messageId++;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      let responseData = '';

      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 10000);

      const onData = (data) => {
        responseData += data.toString();
        const lines = responseData.split('\n');
        
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          try {
            const response = JSON.parse(line);
            if (response.id === id) {
              clearTimeout(timeout);
              mcpProcess.stdout.removeListener('data', onData);
              
              if (response.error) {
                reject(new Error(response.error.message || 'MCP error'));
              } else {
                resolve(response.result);
              }
            }
          } catch (e) {
            // Not JSON, continue
          }
        }
        
        responseData = lines[lines.length - 1];
      };

      mcpProcess.stdout.on('data', onData);
      mcpProcess.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  test('scorm_set_viewport_size should set desktop size', async () => {
    const result = await sendMCPRequest('tools/call', {
      name: 'scorm_set_viewport_size',
      arguments: {
        width: 1366,
        height: 768
      }
    });

    expect(result.content).toBeDefined();
    const content = JSON.parse(result.content[0].text);
    expect(content.success).toBe(true);
    expect(content.size.width).toBe(1366);
    expect(content.size.height).toBe(768);
  });

  test('scorm_set_viewport_size should set mobile size', async () => {
    const result = await sendMCPRequest('tools/call', {
      name: 'scorm_set_viewport_size',
      arguments: {
        width: 390,
        height: 844
      }
    });

    expect(result.content).toBeDefined();
    const content = JSON.parse(result.content[0].text);
    expect(content.success).toBe(true);
    expect(content.size.width).toBe(390);
    expect(content.size.height).toBe(844);
  });

  test('scorm_set_viewport_size should set tablet size', async () => {
    const result = await sendMCPRequest('tools/call', {
      name: 'scorm_set_viewport_size',
      arguments: {
        width: 1024,
        height: 1366
      }
    });

    expect(result.content).toBeDefined();
    const content = JSON.parse(result.content[0].text);
    expect(content.success).toBe(true);
    expect(content.size.width).toBe(1024);
    expect(content.size.height).toBe(1366);
  });

  test('scorm_set_viewport_size should reject too small viewport', async () => {
    try {
      await sendMCPRequest('tools/call', {
        name: 'scorm_set_viewport_size',
        arguments: {
          width: 100,
          height: 100
        }
      });
      fail('Should have thrown error');
    } catch (error) {
      expect(error.message).toMatch(/Minimum viewport size/);
    }
  });

  test('scorm_set_viewport_size should reject too large viewport', async () => {
    try {
      await sendMCPRequest('tools/call', {
        name: 'scorm_set_viewport_size',
        arguments: {
          width: 10000,
          height: 10000
        }
      });
      fail('Should have thrown error');
    } catch (error) {
      expect(error.message).toMatch(/Maximum viewport size/);
    }
  });

  test('scorm_set_viewport_size should require width parameter', async () => {
    try {
      await sendMCPRequest('tools/call', {
        name: 'scorm_set_viewport_size',
        arguments: {
          height: 768
        }
      });
      fail('Should have thrown error');
    } catch (error) {
      expect(error.message).toMatch(/width.*required/i);
    }
  });

  test('scorm_set_viewport_size should require height parameter', async () => {
    try {
      await sendMCPRequest('tools/call', {
        name: 'scorm_set_viewport_size',
        arguments: {
          width: 1366
        }
      });
      fail('Should have thrown error');
    } catch (error) {
      expect(error.message).toMatch(/height.*required/i);
    }
  });

  test('scorm_set_viewport_size should accept custom sizes within bounds', async () => {
    const testCases = [
      { width: 320, height: 240 }, // minimum
      { width: 800, height: 600 }, // custom
      { width: 1920, height: 1080 }, // full HD
      { width: 2560, height: 1440 }, // QHD
      { width: 7680, height: 4320 } // 8K maximum
    ];

    for (const size of testCases) {
      const result = await sendMCPRequest('tools/call', {
        name: 'scorm_set_viewport_size',
        arguments: size
      });

      expect(result.content).toBeDefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.size.width).toBe(size.width);
      expect(content.size.height).toBe(size.height);
    }
  });

  test('scorm_set_viewport_size tool should be listed in available tools', async () => {
    const result = await sendMCPRequest('tools/list');

    expect(result.tools).toBeDefined();
    const viewportTool = result.tools.find(t => t.name === 'scorm_set_viewport_size');
    expect(viewportTool).toBeDefined();
    expect(viewportTool.description).toContain('viewport');
    expect(viewportTool.inputSchema).toBeDefined();
    expect(viewportTool.inputSchema.required).toContain('width');
    expect(viewportTool.inputSchema.required).toContain('height');
  });
});
