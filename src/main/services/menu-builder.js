/**
 * Menu Builder Utility
 * 
 * Extracted from WindowManager to maintain file size limits.
 * Builds application menu templates and handles menu actions.
 * 
 * @fileoverview Application menu builder utility
 */

const { Menu } = require('electron');

/**
 * Menu Builder Class
 * 
 * Handles creation of application menu templates and menu action routing.
 */
class MenuBuilder {
  constructor(windowManager, logger) {
    this.windowManager = windowManager;
    this.logger = logger;
  }

  /**
   * Create application menu template
   * @returns {Array} Menu template array
   */
  createMenuTemplate() {
    return [
      {
        label: 'File',
        submenu: [
          {
            label: 'Load SCORM Package...',
            accelerator: 'CmdOrCtrl+O',
            click: () => this.sendMenuAction('menu-load-package')
          },
          {
            label: 'Close SCORM Package',
            accelerator: 'CmdOrCtrl+W',
            click: () => this.sendMenuAction('menu-close-course')
          },
          { type: 'separator' },
          {
            label: 'Export Session Data...',
            click: () => this.sendMenuAction('menu-export-session')
          },
          { type: 'separator' },
          {
           label: 'Exit',
           accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
           click: () => {
             this.logger?.info('MenuBuilder: Exit menu clicked');
             this.sendMenuAction('menu-exit');
           }
         }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'SCORM',
        submenu: [
          {
            label: 'Reset Session',
            accelerator: 'CmdOrCtrl+R',
            click: () => this.sendMenuAction('menu-reset-session')
          },
          {
            label: 'Simulate LMS Behaviors',
            submenu: [
              {
                label: 'Suspend/Resume',
                click: () => this.sendMenuAction('menu-simulate', 'suspend')
              },
              {
                label: 'Force Complete',
                click: () => this.sendMenuAction('menu-simulate', 'complete')
              },
              {
                label: 'Connection Lost',
                click: () => this.sendMenuAction('menu-simulate', 'disconnect')
              }
            ]
          },
          {
            label: 'Resume Data',
            submenu: [
              {
                label: 'Open File Location',
                click: () => this.sendMenuAction('menu-open-resume-folder')
              },
              {
                label: 'Clear All Files',
                click: () => this.sendMenuAction('menu-clear-resume-data')
              }
            ]
          },
          // Removed legacy "Debug Console" menu item (was opening old debug window).
          // Use "SCORM Inspector" entry under View → SCORM Inspector (Ctrl/Cmd+Shift+S) instead.
        ]
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle Light/Dark Mode',
            accelerator: 'CmdOrCtrl+Shift+T',
            click: () => this.sendMenuAction('menu-toggle-theme')
          },
          { type: 'separator' },
          {
            label: 'Error Log',
            accelerator: 'CmdOrCtrl+Shift+E',
            click: () => this.sendMenuAction('menu-toggle-error-log')
          },
          { type: 'separator' },
          {
            label: 'Fullscreen Course',
            accelerator: 'F11',
            click: () => this.sendMenuAction('menu-fullscreen')
          },
          {
            label: 'Zoom In',
            accelerator: 'CmdOrCtrl+Plus',
            click: () => this.sendMenuAction('menu-zoom', 'in')
          },
          {
            label: 'Zoom Out',
            accelerator: 'CmdOrCtrl+-',
            click: () => this.sendMenuAction('menu-zoom', 'out')
          },
          {
            label: 'Reset Zoom',
            accelerator: 'CmdOrCtrl+0',
            click: () => this.sendMenuAction('menu-zoom', 'reset')
          },
          { type: 'separator' },
          {
            label: 'Toggle Developer Tools',
            accelerator: 'CmdOrCtrl+Shift+I',
            click: () => {
              const mainWindow = this.windowManager.getWindow('main');
              if (mainWindow) {
                mainWindow.webContents.toggleDevTools();
              }
            }
          }
        ]
      }
    ];
  }

  /**
   * Create and set application menu
   * @param {BrowserWindow} mainWindow - Main window instance
   * @returns {boolean} True if menu created successfully
   */
  createApplicationMenu(mainWindow) {
    try {
      const menuTemplate = this.createMenuTemplate();
      const menu = Menu.buildFromTemplate(menuTemplate);
      Menu.setApplicationMenu(menu);
      
      this.logger?.debug('MenuBuilder: Application menu created successfully');
      return true;
      
    } catch (error) {
      this.logger?.error('MenuBuilder: Menu creation failed:', error);
      return false;
    }
  }

  /**
   * Send menu action to main window
   * @param {string} action - Menu action name
   * @param {*} data - Optional action data
   */
  sendMenuAction(action, data = null) {
    const mainWindow = this.windowManager.getWindow('main');

    // Handle Exit entirely in the main process to ensure reliable shutdown
    if (action === 'menu-exit') {
      try {
        const { app } = require('electron');
        this.logger?.info('MenuBuilder: Exit requested, calling app.quit()');
        app.quit();
      } catch (e) {
        this.logger?.error('MenuBuilder: Failed to call app.quit()', e?.message || e);
      }
      return;
    }

    // Handle Resume Data actions locally
    if (action === 'menu-open-resume-folder') {
      try {
        const store = this.windowManager.scormService?.sessionStore;
        if (store) {
          const path = store.getStorePath();
          require('electron').shell.openPath(path);
        } else {
          this.logger?.warn('MenuBuilder: SessionStore not available for open-resume-folder');
        }
      } catch (e) {
        this.logger?.error('MenuBuilder: Failed to open resume folder', e);
      }
      return;
    }

    if (action === 'menu-clear-resume-data') {
      try {
        const store = this.windowManager.scormService?.sessionStore;
        if (store) {
          const { dialog } = require('electron');
          const win = this.windowManager.getWindow('main');
          
          dialog.showMessageBox(win, {
            type: 'question',
            buttons: ['Cancel', 'Clear All'],
            defaultId: 1,
            title: 'Clear Resume Data',
            message: 'Are you sure you want to delete all saved resume data?',
            detail: 'This action cannot be undone.'
          }).then(({ response }) => {
            if (response === 1) {
              store.clearAllSessions().then(count => {
                dialog.showMessageBox(win, {
                  type: 'info',
                  title: 'Resume Data Cleared',
                  message: `Cleared ${count} resume data files.`
                });
              });
            }
          });
        } else {
          this.logger?.warn('MenuBuilder: SessionStore not available for clear-resume-data');
        }
      } catch (e) {
        this.logger?.error('MenuBuilder: Failed to clear resume data', e);
      }
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      // New: also emit a unified 'menu-event' so renderer can handle via a single path
      try { mainWindow.webContents.send('menu-event', { action, data }); } catch (_) { /* intentionally empty */ }
      // Keep original behavior for other menu items (even if they're not implemented)
      mainWindow.webContents.send(action, data);
    }
  }
}

module.exports = MenuBuilder;