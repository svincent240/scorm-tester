
/**
 * @jest-environment jsdom
 */

import { UIStateManager } from '../../../../src/renderer/services/ui-state.js';
import { getInitialUIState } from '../../../../src/renderer/services/ui-state.initial.js';

// Mock dependencies
jest.mock('../../../../src/renderer/services/ui-state.helpers.js', () => ({
  deepMerge: (obj1, obj2) => ({ ...obj1, ...obj2 }),
  getNestedValue: (obj, path) => path.split('.').reduce((o, k) => (o || {})[k], obj),
  setNestedValue: (obj, path, value) => {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((o, k) => o[k] = o[k] || {}, obj);
    target[lastKey] = value;
  },
  safeLoadPersistedUI: jest.fn(),
  safePersistState: jest.fn(),
}));

jest.mock('../../../../src/renderer/services/ui-state.initial.js', () => ({
  getInitialUIState: jest.fn(() => ({
    ui: { theme: 'dark', devModeEnabled: false },
    progressData: null,
  })),
}));

jest.mock('../../../../src/renderer/services/ui-state.notifications.js', () => ({
  showNotification: jest.fn(),
  removeNotification: jest.fn(),
}));

describe('UIState Service', () => {
  let uiState;
  let mockEventBus;

  beforeEach(() => {
    const mockHelpers = {
      deepMerge: (obj1, obj2) => ({ ...obj1, ...obj2 }),
      getNestedValue: (obj, path) => path.split('.').reduce((o, k) => (o || {})[k], obj),
      setNestedValue: (obj, path, value) => {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((o, k) => o[k] = o[k] || {}, obj);
        target[lastKey] = value;
      },
      safeLoadPersistedUI: jest.fn(),
      safePersistState: jest.fn(),
      getInitialUIState: getInitialUIState,
      showNotification: jest.fn(),
      removeNotification: jest.fn(),
      rendererLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }
    };

    uiState = new UIStateManager(mockHelpers);
    
    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
    };
    uiState.eventBus = mockEventBus;
    uiState._initializeState();
  });

  test('should initialize with the default state', () => {
    expect(getInitialUIState).toHaveBeenCalled();
    expect(uiState.getState('ui.theme')).toBe('dark');
  });

  test('setState should update a nested value using dot notation', () => {
    uiState.setState('ui.devModeEnabled', true);
    expect(uiState.getState('ui.devModeEnabled')).toBe(true);
  });

  test('setState should merge an object of updates', () => {
    uiState.setState({ progressData: { score: 100 } });
    expect(uiState.getState('progressData.score')).toBe(100);
    expect(uiState.getState('ui.theme')).toBe('dark'); // Should not overwrite other state
  });

  test('subscribe should notify a listener of any state change', () => {
    const subscriber = jest.fn();
    uiState.subscribe(subscriber);

    uiState.setState('ui.theme', 'light');

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({ ui: { theme: 'light' } }), expect.any(Object));
  });

  test('subscribe should notify a listener only for a specific path change', () => {
    const themeSubscriber = jest.fn();
    const progressSubscriber = jest.fn();
    uiState.subscribe(themeSubscriber, 'ui.theme');
    uiState.subscribe(progressSubscriber, 'progressData');

    uiState.setState('ui.theme', 'light');

    expect(themeSubscriber).toHaveBeenCalledTimes(1);
    expect(themeSubscriber).toHaveBeenCalledWith('light', 'dark', 'ui.theme');
    expect(progressSubscriber).not.toHaveBeenCalled();
  });

  test('an unsubscribe function should prevent future notifications', () => {
    const subscriber = jest.fn();
    const unsubscribe = uiState.subscribe(subscriber);

    unsubscribe();
    uiState.setState('ui.theme', 'light');

    expect(subscriber).not.toHaveBeenCalled();
  });

  test('setState should emit a "state:changed" event on the event bus', () => {
    uiState.setState({ ui: { devModeEnabled: true } });
    expect(mockEventBus.emit).toHaveBeenCalledWith('state:changed', expect.any(Object));
  });

  test('setState should not emit events when silent is true', () => {
    const subscriber = jest.fn();
    uiState.subscribe(subscriber);

    uiState.setState('ui.theme', 'light', true);

    expect(subscriber).not.toHaveBeenCalled();
    expect(mockEventBus.emit).not.toHaveBeenCalledWith('state:changed', expect.any(Object));
  });
});
