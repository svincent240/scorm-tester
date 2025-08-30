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
          // Removed legacy "Debug Console" menu item (was opening old debug window).
          // Use "SCORM Inspector" entry under View → SCORM Inspector (Ctrl/Cmd+Shift+S) instead.
        ]
      },
      {
        label: 'View',
        submenu: [
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
          },
          {
            label: 'SCORM Inspector',
            accelerator: 'CmdOrCtrl+Shift+S',
            click: () => this.windowManager.createScormInspectorWindow()
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Special handling for exit menu - send as menu-event for renderer processing
      if (action === 'menu-exit') {
        mainWindow.webContents.send('menu-event', { action: 'exit', data });
      } else {
        // Keep original behavior for other menu items (even if they're not implemented)
        mainWindow.webContents.send(action, data);
      }
    }
  }
}

module.exports = MenuBuilder;