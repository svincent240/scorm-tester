"use strict";

class ToolRouter {
  constructor() {
    this.tools = new Map();
  }

  register(name, handler) {
    if (!name || typeof handler !== "function") {
      throw new Error("Tool registration requires name and function handler");
    }
    this.tools.set(name, handler);
  }

  has(name) {
    return this.tools.has(name);
  }

  async dispatch(name, params) {
    const handler = this.tools.get(name);
    if (!handler) {
      const e = new Error(`Unknown tool: ${name}`);
      e.code = "MCP_UNKNOWN_TOOL";
      throw e;
    }
    return handler(params || {});
  }
}

module.exports = ToolRouter;

