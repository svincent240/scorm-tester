const ToolRouter = require('../../../src/mcp/router');

describe('ToolRouter', () => {
  test('register and dispatch tool', async () => {
    const router = new ToolRouter();
    router.register('hello', async ({ name }) => ({ msg: `hi ${name}` }));
    const result = await router.dispatch('hello', { name: 'world' });
    expect(result).toEqual({ msg: 'hi world' });
  });

  test('unknown tool throws', async () => {
    const router = new ToolRouter();
    await expect(router.dispatch('nope', {})).rejects.toBeInstanceOf(Error);
  });
});

