const { successEnvelope, errorEnvelope } = require('../../../src/mcp/envelope');

describe('MCP envelope helpers', () => {
  test('successEnvelope structure', () => {
    const startedAt = Date.now() - 5;
    const env = successEnvelope({ data: { ok: true }, artifacts: [{ type: 'report', path: 'sessions/1/a.html' }], message: 'done', startedAt });
    expect(env.success).toBe(true);
    expect(env.error_code).toBeNull();
    expect(env.message).toBe('done');
    expect(env.data).toEqual({ ok: true });
    expect(Array.isArray(env.artifacts)).toBe(true);
    expect(typeof env.diagnostics.duration_ms).toBe('number');
  });

  test('errorEnvelope structure', () => {
    const startedAt = Date.now() - 5;
    const env = errorEnvelope({ error_code: 'TEST_ERR', message: 'boom', data: { detail: 1 }, startedAt });
    expect(env.success).toBe(false);
    expect(env.error_code).toBe('TEST_ERR');
    expect(env.message).toBe('boom');
    expect(env.data).toEqual({ detail: 1 });
    expect(typeof env.diagnostics.duration_ms).toBe('number');
  });
});

