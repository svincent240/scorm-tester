/**
 * UI State - Notifications module
 * Extracted to reduce ui-state.js size and isolate notification behavior.
 */

export function showNotification(self, notification) {
  const notifications = [...(self.state.ui?.notifications || [])];
  const id = Date.now() + Math.random();

  notifications.push({
    id,
    type: 'info',
    duration: 5000,
    ...notification,
    timestamp: Date.now()
  });

  self.updateUI({ notifications });

  // Auto-remove notification
  const duration = notification?.duration;
  if (duration !== 0) {
    setTimeout(() => {
      try {
        removeNotification(self, id);
      } catch (_) { /* no-op */ }
    }, typeof duration === 'number' ? duration : 5000);
  }

  return id;
}

export function removeNotification(self, id) {
  const notifications = (self.state.ui?.notifications || []).filter(n => n.id !== id);
  self.updateUI({ notifications });
}