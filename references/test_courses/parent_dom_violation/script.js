// SCORM API Discovery (legitimate)
var API = null;
var findAPITries = 0;

function findAPI(win) {
  while ((win.API_1484_11 == null) && (win.parent != null) && (win.parent != win)) {
    findAPITries++;
    if (findAPITries > 500) {
      return null;
    }
    win = win.parent;
  }
  return win.API_1484_11;
}

API = findAPI(window);

if (API) {
  API.Initialize("");
  API.SetValue("cmi.completion_status", "incomplete");
  API.SetValue("cmi.success_status", "unknown");
  API.Commit("");
}

// VIOLATION: Accessing parent window DOM (should be detected)
try {
  var headerElement = parent.document.getElementById("header-controls");
  if (headerElement) {
    console.log("Found parent header element");
  }
} catch (e) {
  console.log("Could not access parent DOM (expected in real LMS)");
}

// VIOLATION: Querying parent DOM (should be detected)
try {
  var parentBody = parent.document.body;
  if (parentBody) {
    console.log("Accessed parent body");
  }
} catch (e) {
  console.log("Could not access parent body");
}

// VIOLATION: Using querySelector on parent (should be detected)
try {
  var parentElement = parent.document.querySelector(".app-container");
  if (parentElement) {
    console.log("Found parent container");
  }
} catch (e) {
  console.log("Could not query parent DOM");
}

function completeLesson() {
  if (API) {
    API.SetValue("cmi.completion_status", "completed");
    API.SetValue("cmi.success_status", "passed");
    API.SetValue("cmi.score.raw", "100");
    API.SetValue("cmi.score.min", "0");
    API.SetValue("cmi.score.max", "100");
    API.Commit("");
    API.Terminate("");
  }
  alert("Lesson completed!");
}

