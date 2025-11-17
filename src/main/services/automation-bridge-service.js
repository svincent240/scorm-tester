"use strict";

const BaseService = require("./base-service");
const { WINDOW_TYPES } = require("../../shared/constants/main-process-constants");
const {
  automationCheckAvailability,
  automationGetCourseStructure,
  automationGetCurrentSlide,
  automationGoToSlide,
  AUTOMATION_ERROR_CODES
} = require("../../shared/automation/navigation");

class AutomationBridgeService extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super("AutomationBridgeService", errorHandler, logger, options);
    this.windowManager = null;
    this.frameSelector = options.frameSelector || "#content-frame";
    this.sessionState = new Map();
  }

  validateDependencies() {
    const windowManager = this.getDependency("windowManager");
    if (!windowManager) {
      this.logger?.error("AutomationBridgeService: WindowManager dependency missing");
      return false;
    }
    return true;
  }

  async doInitialize() {
    this.windowManager = this.getDependency("windowManager");
    this.logger?.info("AutomationBridgeService: initialized");
  }

  async doShutdown() {
    this.sessionState.clear();
  }

  getState(sessionId) {
    if (!sessionId) {
      return null;
    }
    return this.sessionState.get(sessionId) || null;
  }

  async probeAutomation(sessionId, metadata = {}) {
    if (!sessionId || typeof sessionId !== "string") {
      throw new Error("sessionId is required");
    }

    const execute = await this.createRendererExecutor();
    const statePatch = {
      sessionId,
      lastCheckedAt: Date.now(),
      lastError: null,
      reason: metadata.reason || null
    };

    try {
      const availability = await automationCheckAvailability({
        execute,
        logger: this.logger,
        sessionId
      });

      statePatch.available = !!availability.available;
      statePatch.version = availability.version || null;

      if (availability.available) {
        try {
          const { structure } = await automationGetCourseStructure({ execute, logger: this.logger, sessionId });
          statePatch.structure = structure || null;
        } catch (error) {
          statePatch.structure = null;
          statePatch.lastError = error?.message || String(error);
        }

        try {
          const { slideId } = await automationGetCurrentSlide({ execute, logger: this.logger, sessionId });
          statePatch.currentSlide = slideId || null;
        } catch (error) {
          statePatch.currentSlide = null;
          statePatch.lastError = error?.message || String(error);
        }
      } else {
        statePatch.available = false;
        statePatch.structure = null;
        statePatch.currentSlide = null;
        statePatch.lastError = 'Automation API not available for this course';
      }
    } catch (error) {
      statePatch.available = false;
      statePatch.structure = null;
      statePatch.currentSlide = null;
      statePatch.lastError = error?.message || String(error);
    }

    const nextState = this.updateSessionState(sessionId, statePatch);
    return { success: true, state: nextState };
  }

  async navigateToSlide({ sessionId, slideId, context }) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('sessionId is required');
    }
    if (!slideId || typeof slideId !== 'string') {
      throw new Error('slideId is required');
    }

    const execute = await this.createRendererExecutor();
    try {
      const result = await automationGoToSlide({ execute, logger: this.logger, sessionId, slideId, context });
      const statePatch = {
        lastCheckedAt: Date.now(),
        currentSlide: slideId,
        lastError: null
      };
      this.updateSessionState(sessionId, statePatch);
      return { success: result?.success !== false, slideId, context: context || null };
    } catch (error) {
      this.updateSessionState(sessionId, {
        lastCheckedAt: Date.now(),
        lastError: error?.message || String(error)
      });
      throw error;
    }
  }

  updateSessionState(sessionId, patch = {}) {
    const current = this.sessionState.get(sessionId) || {
      sessionId,
      available: false,
      version: null,
      structure: null,
      currentSlide: null,
      lastCheckedAt: null,
      lastError: null
    };

    const next = { ...current, ...patch };
    this.sessionState.set(sessionId, next);
    this.broadcastState(next);
    return next;
  }

  broadcastState(state) {
    if (!state) return;
    try {
      this.windowManager?.broadcastToAllWindows?.('automation:state-update', state);
    } catch (error) {
      this.logger?.warn('AutomationBridgeService: failed to broadcast state', error?.message || error);
    }
  }

  async createRendererExecutor() {
    const windowManager = this.windowManager || this.getDependency('windowManager');
    if (!windowManager) {
      throw new Error('WindowManager unavailable');
    }
    const mainWindow = windowManager.getWindow(WINDOW_TYPES.MAIN);
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Main window not available');
    }
    const { webContents } = mainWindow;
    if (!webContents) {
      throw new Error('Main window webContents unavailable');
    }

    return (expression) => webContents.executeJavaScript(this.wrapExpressionForContentFrame(expression), true);
  }

  wrapExpressionForContentFrame(expression) {
    const expressionLiteral = JSON.stringify(expression);
    const selectorLiteral = JSON.stringify(this.frameSelector);
    const frameNotReady = AUTOMATION_ERROR_CODES.FRAME_NOT_READY;
    const execUnavailable = AUTOMATION_ERROR_CODES.FRAME_EXECUTOR_UNAVAILABLE;
    const execError = AUTOMATION_ERROR_CODES.FRAME_EXEC_ERROR;

    return `(() => {
      try {
        const frame = document.querySelector(${selectorLiteral});
        if (!frame || !frame.contentWindow) {
          return { __automationError: '${frameNotReady}' };
        }
        const targetWindow = frame.contentWindow;
        if (typeof targetWindow.eval === 'function') {
          return targetWindow.eval(${expressionLiteral});
        }
        if (typeof targetWindow.Function === 'function') {
          const fn = targetWindow.Function('return (' + ${expressionLiteral} + ')');
          return fn();
        }
        return { __automationError: '${execUnavailable}' };
      } catch (error) {
        return {
          __automationError: '${execError}',
          message: error?.message || String(error)
        };
      }
    })()`;
  }
}

module.exports = AutomationBridgeService;
