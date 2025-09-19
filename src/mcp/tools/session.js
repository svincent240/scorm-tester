"use strict";

const sessions = require("../session");

async function scorm_session_open(params) {
  return sessions.open(params || {});
}

async function scorm_session_status(params) {
  return sessions.status(params || {});
}

async function scorm_session_events(params) {
  return sessions.events(params || {});
}

async function scorm_session_close(params) {
  return sessions.close(params || {});
}

module.exports = {
  scorm_session_open,
  scorm_session_status,
  scorm_session_events,
  scorm_session_close,
};

