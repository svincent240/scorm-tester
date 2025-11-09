"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

describe("Session Rotation", () => {
  let SessionManager;
  let sessionManager;
  let testCourseDir;
  let tempRoot;

  beforeAll(() => {
    // Set max sessions to 3 for faster testing
    process.env.SCORM_TESTER_MAX_SESSIONS_PER_COURSE = "3";

    // Create test course directory
    testCourseDir = path.join(os.tmpdir(), `scorm-test-course-${Date.now()}`);
    fs.mkdirSync(testCourseDir, { recursive: true });

    // Create dummy manifest
    fs.writeFileSync(
      path.join(testCourseDir, "imsmanifest.xml"),
      '<?xml version="1.0"?><manifest></manifest>'
    );

    // Require after env var is set
    SessionManager = require("../../../src/mcp/session");
    sessionManager = SessionManager;
  });

  afterAll(() => {
    // Clean up test course
    try {
      fs.rmSync(testCourseDir, { recursive: true, force: true });
    } catch (_) { /* intentionally empty */ }

    // Clean up test sessions
    try {
      const courseHash = crypto.createHash("sha256")
        .update(path.resolve(testCourseDir))
        .digest("hex")
        .substring(0, 16);
      const courseFolder = path.join(os.tmpdir(), "scorm-tester", "mcp_sessions", courseHash);
      fs.rmSync(courseFolder, { recursive: true, force: true });
    } catch (_) { /* intentionally empty */ }

    delete process.env.SCORM_TESTER_MAX_SESSIONS_PER_COURSE;
  });

  test("should create course-specific folder for screenshots based on package path", () => {
    const session1 = sessionManager.open({ package_path: testCourseDir });
    const s = sessionManager.sessions.get(session1.session_id);

    expect(session1.session_id).toBeDefined();
    expect(session1.workspace).toContain("mcp_sessions");
    expect(fs.existsSync(session1.workspace)).toBe(true);

    // Session should have a course_screenshots_folder
    expect(s.course_screenshots_folder).toBeDefined();
    expect(fs.existsSync(s.course_screenshots_folder)).toBe(true);

    // Screenshots folder should contain course hash
    const courseHash = crypto.createHash("sha256")
      .update(path.resolve(testCourseDir))
      .digest("hex")
      .substring(0, 16);
    expect(s.course_screenshots_folder).toContain(courseHash);

    sessionManager.close({ session_id: session1.session_id });
  });

  test("should share screenshots folder across sessions from same course", () => {
    const session1 = sessionManager.open({ package_path: testCourseDir });
    const session2 = sessionManager.open({ package_path: testCourseDir });

    const s1 = sessionManager.sessions.get(session1.session_id);
    const s2 = sessionManager.sessions.get(session2.session_id);

    // Both sessions should share the same screenshots folder
    expect(s1.course_screenshots_folder).toBe(s2.course_screenshots_folder);

    // But have different workspaces
    expect(session1.workspace).not.toBe(session2.workspace);

    sessionManager.close({ session_id: session1.session_id });
    sessionManager.close({ session_id: session2.session_id });
  });

  test("should rotate old screenshots when exceeding MAX_SESSIONS_PER_COURSE", async () => {
    const s1 = sessionManager.sessions.get(sessionManager.open({ package_path: testCourseDir }).session_id);
    const screenshotsFolder = s1.course_screenshots_folder;

    // Create 4 fake screenshots (max is 3)
    const screenshot1 = path.join(screenshotsFolder, "screenshot_1.jpg");
    fs.writeFileSync(screenshot1, "fake 1");
    await new Promise(resolve => setTimeout(resolve, 100));

    const screenshot2 = path.join(screenshotsFolder, "screenshot_2.jpg");
    fs.writeFileSync(screenshot2, "fake 2");
    await new Promise(resolve => setTimeout(resolve, 100));

    const screenshot3 = path.join(screenshotsFolder, "screenshot_3.jpg");
    fs.writeFileSync(screenshot3, "fake 3");
    await new Promise(resolve => setTimeout(resolve, 100));

    // All 3 should exist
    expect(fs.existsSync(screenshot1)).toBe(true);
    expect(fs.existsSync(screenshot2)).toBe(true);
    expect(fs.existsSync(screenshot3)).toBe(true);

    // Trigger rotation by creating 4th screenshot
    sessionManager.rotateScreenshots(screenshotsFolder);
    const screenshot4 = path.join(screenshotsFolder, "screenshot_4.jpg");
    fs.writeFileSync(screenshot4, "fake 4");

    // Screenshot 1 should be deleted (oldest)
    expect(fs.existsSync(screenshot1)).toBe(false);

    // Screenshots 2, 3, 4 should still exist
    expect(fs.existsSync(screenshot2)).toBe(true);
    expect(fs.existsSync(screenshot3)).toBe(true);
    expect(fs.existsSync(screenshot4)).toBe(true);

    sessionManager.close({ session_id: s1.id });
  });

  test("should rotate only screenshots, not session workspaces", async () => {
    const session1 = sessionManager.open({ package_path: testCourseDir });
    const session2 = sessionManager.open({ package_path: testCourseDir });

    const s1 = sessionManager.sessions.get(session1.session_id);
    const screenshotsFolder = s1.course_screenshots_folder;

    // Create screenshots
    const screenshot1 = path.join(screenshotsFolder, "screenshot_1.jpg");
    const screenshot2 = path.join(screenshotsFolder, "screenshot_2.jpg");
    const screenshot3 = path.join(screenshotsFolder, "screenshot_3.jpg");

    fs.writeFileSync(screenshot1, "fake 1");
    await new Promise(resolve => setTimeout(resolve, 100));
    fs.writeFileSync(screenshot2, "fake 2");
    await new Promise(resolve => setTimeout(resolve, 100));
    fs.writeFileSync(screenshot3, "fake 3");
    await new Promise(resolve => setTimeout(resolve, 100));

    // Rotate and create 4th screenshot
    sessionManager.rotateScreenshots(screenshotsFolder);
    const screenshot4 = path.join(screenshotsFolder, "screenshot_4.jpg");
    fs.writeFileSync(screenshot4, "fake 4");

    // Screenshot 1 should be deleted
    expect(fs.existsSync(screenshot1)).toBe(false);

    // But both session workspaces should still exist
    expect(fs.existsSync(session1.workspace)).toBe(true);
    expect(fs.existsSync(session2.workspace)).toBe(true);

    // Cleanup
    sessionManager.close({ session_id: session1.session_id });
    sessionManager.close({ session_id: session2.session_id });
  });

  test("should handle different courses in separate screenshot folders", () => {
    // Create second test course
    const testCourseDir2 = path.join(os.tmpdir(), `scorm-test-course-2-${Date.now()}`);
    fs.mkdirSync(testCourseDir2, { recursive: true });
    fs.writeFileSync(
      path.join(testCourseDir2, "imsmanifest.xml"),
      '<?xml version="1.0"?><manifest></manifest>'
    );

    try {
      const session1 = sessionManager.open({ package_path: testCourseDir });
      const session2 = sessionManager.open({ package_path: testCourseDir2 });

      const s1 = sessionManager.sessions.get(session1.session_id);
      const s2 = sessionManager.sessions.get(session2.session_id);

      // Different courses should have different screenshot folders
      expect(s1.course_screenshots_folder).not.toBe(s2.course_screenshots_folder);

      sessionManager.close({ session_id: session1.session_id });
      sessionManager.close({ session_id: session2.session_id });
    } finally {
      // Cleanup second course
      fs.rmSync(testCourseDir2, { recursive: true, force: true });
    }
  });

  test("getCourseHash should return stable 16-char hash", () => {
    const SessionManagerClass = require("../../../src/mcp/session").constructor;

    const hash1 = SessionManagerClass.getCourseHash(testCourseDir);
    const hash2 = SessionManagerClass.getCourseHash(testCourseDir);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(16);
    expect(/^[a-f0-9]{16}$/.test(hash1)).toBe(true);
  });
});
