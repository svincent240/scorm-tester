/**
 * UI State - Debug mirroring and RTE helpers
 * Extracted from ui-state.js to reduce file size and isolate diagnostics behavior.
 */

export function setupDebugMirroring(self) {
  // Mirror EventBus emissions into diagnostics buffer when dev mode is enabled
  const mirror = (eventName) => {
    self.eventBus.on(eventName, (payload) => {
      try {
        if (!self.state.ui?.devModeEnabled) return;
        const dbg = { ...(self.state.debug || {}), lastEvents: [...(self.state.debug?.lastEvents || [])] };
        dbg.lastEvents.push({
          event: eventName,
          data: payload,
          timestamp: Date.now(),
          id: Date.now() + Math.random()
        });
        const maxE = dbg.maxEvents || 200;
        while (dbg.lastEvents.length > maxE) dbg.lastEvents.shift();
        self.setState({ debug: dbg }, null, true);
      } catch (_) { /* no-op */ }
    });
  };

  // Core events to observe for diagnostics snapshotting
  ['api:call', 'error', 'navigation:updated', 'progress:updated', 'course:loaded', 'session:updated', 'ui:updated']
    .forEach(mirror);

  // Expose lightweight enablement selectors for Attempt lifecycle controls
  self.getRteStatus = () => {
    // If not in browser, return safe defaults to keep tests stable
    if (!(typeof window !== 'undefined')) {
      return { initialized: false, terminated: false, suspended: false };
    }

    const initialized = !!(window && window.scormClient && window.scormClient.getInitialized && window.scormClient.getInitialized());
    // Temporary derivation until explicit lifecycle flags are surfaced
    // TODO(rte): replace with main/RTE-surfaced lifecycle flags when available
    let terminated = false;
    let suspended = false;
    try {
      if (window && window.scormClient) {
        // Heuristic: check cached data-model keys
        const exitVal = window.scormClient.getCachedValue && window.scormClient.getCachedValue('cmi.exit');
        const suspendData = window.scormClient.getCachedValue && window.scormClient.getCachedValue('cmi.suspend_data');
        suspended = String(exitVal || '').toLowerCase() === 'suspend' || !!(suspendData && String(suspendData).length > 0);
        terminated = typeof window.scormClient.getTerminated === 'function' ? !!window.scormClient.getTerminated() : false;
      }
    } catch (_) { /* no-op */ }
    return { initialized, terminated, suspended };
  };

  self.getAttemptEnablement = () => {
    const { initialized, terminated, suspended } = self.getRteStatus();
    const canStart = !initialized;
    const canSuspend = initialized && !terminated && !suspended;
    const canResume = initialized && !terminated && suspended;
    const canCommit = initialized && !terminated;
    const canTerminate = initialized && !terminated;
    const reasons = {
      start: initialized ? 'Already initialized (RTE 3.2.1)' : '',
      suspend: !initialized ? 'Initialize first (RTE 3.2.1)' : (terminated ? 'Terminated' : ''),
      resume: !initialized ? 'Initialize first (RTE 3.2.1)' : (!suspended ? 'Not suspended' : ''),
      commit: !initialized ? 'Initialize first (RTE 3.2.1)' : (terminated ? 'Terminated' : ''),
      terminate: !initialized ? 'Initialize first (RTE 3.2.1)' : ''
    };
    return { canStart, canSuspend, canResume, canCommit, canTerminate, reasons };
  };

  // Provide explicit API to toggle dev mode and broadcast
  if (!self.setDevModeEnabled) {
    self.setDevModeEnabled = (enabled) => {
      const prev = !!self.state.ui.devModeEnabled;
      const next = !!enabled;
      if (prev === next) return;
      self.updateUI({ devModeEnabled: next });
      // updateUI emits ui:devModeChanged when the flag changes
      try {
        // Keep EventBus in sync and broadcast a debug:update mode payload
        self.eventBus?.setDebugMode?.(next);
        self.eventBus?.emit?.('debug:update', { mode: next });
      } catch (_) { /* no-op */ }
    };
  }
}