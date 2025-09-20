/** @jest-environment jsdom */

import { CourseOutline } from '@/renderer/components/scorm/course-outline.js';

describe('CourseOutline escaping', () => {
  test('showNavigationBlockedMessage escapes reason HTML', () => {
    // Set up container element
    document.body.innerHTML = '<div id="co"></div>';
    const container = document.getElementById('co');

    // Create instance without full initialize; manually bind element
    const outline = new CourseOutline('co', { autoRender: false });
    outline.element = container;

    const malicious = '<img src=x onerror=alert(1)>'; // should be escaped
    outline.showNavigationBlockedMessage('activity-1', malicious);

    const notification = container.querySelector('.course-outline__notification');
    expect(notification).toBeTruthy();

    const messageEl = notification.querySelector('.notification__message');
    expect(messageEl).toBeTruthy();

    const html = messageEl.innerHTML;
    expect(html.includes('<img')).toBe(false);
    expect(html.includes('&lt;img')).toBe(true);
  });
});

