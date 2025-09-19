"use strict";

function parseCliArgs(argv = []) {
  const flags = { allow_network: false };

  for (const arg of argv) {
    if (arg === "--allow-network" || arg === "--allow_network") { flags.allow_network = true; }
    else if (arg.startsWith("--")) {
      // Parse --key=value for forward-compatible flags
      const idx = arg.indexOf("=");
      if (idx > 2) {
        const k = arg.slice(2, idx);
        const v = arg.slice(idx + 1);
        flags[k] = v === "true" ? true : (v === "false" ? false : v);
      } else {
        flags[arg.slice(2)] = true;
      }
    }
  }
  return flags;
}

module.exports = { parseCliArgs };

