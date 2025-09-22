/**
 * @jest-environment jsdom
 */

describe('escapeHTML utility', () => {
  test('escapes special HTML characters', async () => {
    const { escapeHTML } = await import('../../../src/renderer/utils/escape.js');
    expect(escapeHTML("<div> & \" '")).toBe('&lt;div&gt; &amp; &quot; &#39;');
  });

  test('handles null/undefined safely', async () => {
    const { escapeHTML } = await import('../../../src/renderer/utils/escape.js');
    expect(escapeHTML(null)).toBe('');
    expect(escapeHTML(undefined)).toBe('');
  });
});

