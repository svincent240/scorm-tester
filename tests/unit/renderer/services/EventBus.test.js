
/**
 * @jest-environment jsdom
 */

import { EventBus } from '../../../../src/renderer/services/event-bus.js';

describe('EventBus Service', () => {
  let eventBus;

  beforeEach(() => {
    // Mock the logger import to prevent errors
    jest.mock('../../../../src/renderer/utils/renderer-logger.js', () => ({
      rendererLogger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));
    // Mock electronAPI for the logger
    global.window.electronAPI = {
      rendererBaseUrl: '../'
    };
    eventBus = new EventBus();
  });

  test('should subscribe to and emit an event', () => {
    const handler = jest.fn();
    eventBus.on('test-event', handler);
    eventBus.emit('test-event', { payload: 'data' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ payload: 'data' }, expect.any(Object));
  });

  test('should pass data to multiple subscribers', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    eventBus.on('multi-event', handler1);
    eventBus.on('multi-event', handler2);
    eventBus.emit('multi-event', 'test-data');

    expect(handler1).toHaveBeenCalledWith('test-data', expect.any(Object));
    expect(handler2).toHaveBeenCalledWith('test-data', expect.any(Object));
  });

  test('should unsubscribe from an event', () => {
    const handler = jest.fn();
    const unsubscribe = eventBus.on('unsub-event', handler);
    
    eventBus.emit('unsub-event');
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    eventBus.emit('unsub-event');
    expect(handler).toHaveBeenCalledTimes(1); // Should not be called again
  });

  test('off() method should remove the correct handler', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    eventBus.on('off-event', handler1);
    eventBus.on('off-event', handler2);

    eventBus.off('off-event', handler1);
    eventBus.emit('off-event');

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  test('once() should only trigger the handler once', () => {
    const handler = jest.fn();
    eventBus.once('once-event', handler);

    eventBus.emit('once-event');
    eventBus.emit('once-event');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('should not trigger listeners for a different event', () => {
    const handler = jest.fn();
    eventBus.on('event-a', handler);
    eventBus.emit('event-b', 'data-b');

    expect(handler).not.toHaveBeenCalled();
  });

  test('clear() should remove all listeners for a specific event', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    eventBus.on('clear-event', handler1);
    eventBus.on('clear-event', handler2);

    eventBus.clear('clear-event');
    eventBus.emit('clear-event');

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  test('clear() should remove all listeners if no event is specified', () => {
    const handlerA = jest.fn();
    const handlerB = jest.fn();
    eventBus.on('event-a', handlerA);
    eventBus.on('event-b', handlerB);

    eventBus.clear();
    eventBus.emit('event-a');
    eventBus.emit('event-b');

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).not.toHaveBeenCalled();
  });
});
