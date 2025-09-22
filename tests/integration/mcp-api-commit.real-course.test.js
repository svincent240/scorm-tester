const { spawn } = require('child_process');
const path = require('path');

describe('MCP API flow (Initialize → Commit → Terminate) on persistent runtime', () => {
  jest.setTimeout(90000);

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
        } catch (_) {}
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

  test('Initialize → Commit → Terminate returns true', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');
    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = openSession && openSession.result && openSession.result.data;
    expect(openData && openData.session_id).toBeTruthy();
    const session_id = openData.session_id;

    const runtimeOpen = await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);
    const runtimeData = runtimeOpen && runtimeOpen.result && runtimeOpen.result.data;
    expect(runtimeData && runtimeData.runtime_id === session_id).toBe(true);

    const apiInit = await rpc('tools/call', { name: 'scorm_attempt_initialize', arguments: { session_id } }, id++);
    const apiInitData = apiInit && apiInit.result && apiInit.result.data;
    expect(apiInitData && apiInitData.result === 'true').toBe(true);

    const apiCommit = await rpc('tools/call', { name: 'scorm_api_call', arguments: { session_id, method: 'Commit', args: [''] } }, id++);
    const apiCommitData = apiCommit && apiCommit.result && apiCommit.result.data;
    expect(apiCommitData && apiCommitData.result === 'true').toBe(true);

    const apiTerm = await rpc('tools/call', { name: 'scorm_attempt_terminate', arguments: { session_id } }, id++);
    const apiTermData = apiTerm && apiTerm.result && apiTerm.result.data;
    expect(apiTermData && apiTermData.result === 'true').toBe(true);

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });
});

