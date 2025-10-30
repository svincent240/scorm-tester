const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP scorm_test_api_integration on real course (smoke run)', () => {
  jest.setTimeout(60000);

  function rpcClient() {
    const proc = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '-s', 'mcp'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: 'false' }
    });

    let buf = '';
    const pending = new Map();

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const id = obj && obj.id;
          if (pending.has(id)) {
            pending.get(id)(obj);
            pending.delete(id);
          }
        } catch (_) {
          // ignore non-JSON
        }
      }
    });

    function rpc(method, params, id) {
      return new Promise((resolve) => {
        pending.set(id, resolve);
        const msg = { jsonrpc: '2.0', id, method, params };
        proc.stdin.write(JSON.stringify(msg) + '\n');
      });
    }

    return { proc, rpc };
  }

  test('runs initialize and scorm_test_api_integration and prints results', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;
    const initRes = await rpc('initialize', {}, id++);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');
    const argumentsObj = {
      workspace_path: ws,
      capture_api_calls: true,
      viewport: { device: 'desktop' },
      test_scenario: {
        steps: ['Initialize', 'SetValue cmi.location hole_1', 'Terminate']
      }
    };
    const callRes = await rpc('tools/call', { name: 'scorm_test_api_integration', arguments: argumentsObj }, id++);
    const data = parseMcpResponse(callRes);

    // Emit a single line for easy scraping from CI output
    const payload = {
      init_ok: !!initRes && !initRes.error,
      manifest_ok: !!(data && data.manifest_ok),
      scorm_version: data && data.scorm_version,
      initialize_success: data && data.api_test_results && data.api_test_results.initialize_success,
      call_count: data && data.api_test_results && data.api_test_results.api_calls_captured && data.api_test_results.api_calls_captured.length || 0,
      sample_calls: (data && data.api_test_results && data.api_test_results.api_calls_captured || []).slice(0, 3)
    };
    console.log('MCP_API_RESULT_JSON=' + JSON.stringify(payload));

    try { proc.stdin.end(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    // Wait for MCP process to exit to avoid open handle warnings
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);

    // Basic sanity assertion so the test doesn't pass silently without running
    expect(payload.init_ok).toBe(true);
  });
});

