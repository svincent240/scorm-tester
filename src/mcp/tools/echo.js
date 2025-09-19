"use strict";

async function scorm_echo(params) {
  return {
    echoed: params || null,
    note: "SCORM MCP echo tool (for smoke testing)"
  };
}

module.exports = { scorm_echo };

