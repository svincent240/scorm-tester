import { Application } from 'spectron';
import path from 'path';
import { expect } from 'chai';

describe('API Timeline Debug Window Integration', function () {
    this.timeout(10000); // Increased timeout for Electron app launch

    let app;

    before(async function () {
        app = new Application({
            path: path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron'),
            args: [path.join(__dirname, '..', '..', 'src', 'main', 'main.js')],
            webdriverOptions: {
                deprecationWarnings: false // Suppress deprecation warnings from Electron/WebDriver
            }
        });
        await app.start();
    });

    after(async function () {
        if (app && app.isRunning()) {
            await app.stop();
        }
    });

    it('should open the API timeline debug window when the debug toggle is clicked', async function () {
        const client = app.client;

        // Wait for the main window to be visible
        await client.waitUntilWindowLoaded();
        await client.browserWindow.isVisible();

        // Click the debug toggle button
        const debugToggleSelector = '#debug-toggle';
        await client.waitForExist(debugToggleSelector);
        await client.click(debugToggleSelector);

        // Wait for a new window to appear (the debug window)
        await client.waitUntil(async () => {
            const windows = await client.getWindowHandles();
            return windows.length === 2; // Expecting main window + debug window
        }, 5000, 'Expected a second window (debug window) to open');

        // Switch to the new debug window
        const windows = await client.getWindowHandles();
        await client.window(windows[1]); // Switch to the second window

        // Verify the debug window content
        await client.waitUntilWindowLoaded();
        const title = await client.getTitle();
        expect(title).to.equal('SCORM Tester Debug Window');

        const apiTimelineContainer = await client.waitForExist('#api-timeline-container');
        expect(apiTimelineContainer).to.be.true;

        // Optionally, check for initial "No API calls recorded" message
        const emptyMessage = await client.getText('#api-timeline-container .debug-log__empty');
        expect(emptyMessage).to.equal('No API calls recorded');

        // Switch back to the main window for cleanup or further tests
        await client.window(windows[0]);
    });

    // TODO: Add more tests to simulate API calls and verify they appear in the timeline
});