import { describe, it, expect, vi } from 'vitest';
import { ModeManager } from '../src/core/mode/modeManager';

describe('ModeManager', () => {
  it('starts in Normal', () => {
    expect(new ModeManager().current).toBe('Normal');
  });

  it('allows legal transitions and publishes context', () => {
    const setContext = vi.fn();
    const mm = new ModeManager(setContext);
    expect(mm.transition('Insert')).toBe(true);
    expect(mm.current).toBe('Insert');
    expect(setContext).toHaveBeenLastCalledWith('lazycode.mode', 'Insert');
  });

  it('rejects illegal transitions', () => {
    const mm = new ModeManager();
    mm.transition('Insert');
    expect(mm.transition('Visual')).toBe(false); // Insert → Visual is not legal
    expect(mm.current).toBe('Insert');
  });

  it('is a no-op when transitioning to the current mode', () => {
    const listener = vi.fn();
    const mm = new ModeManager();
    mm.onDidChange(listener);
    expect(mm.transition('Normal')).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies listeners with from/to', () => {
    const listener = vi.fn();
    const mm = new ModeManager();
    mm.onDidChange(listener);
    mm.transition('Visual');
    expect(listener).toHaveBeenCalledWith({ from: 'Normal', to: 'Visual' });
  });
});
