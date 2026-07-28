import { describe, it, expect } from 'vitest';
import { parseOverrides, mergeKeymapOverrides, parsedKeymaps } from '../src/lazyvim/keymaps';

describe('parseOverrides', () => {
  it('parses the string form (command only)', () => {
    const o = parseOverrides({ '<leader>xx': 'workbench.action.quickOpen' });
    expect(o.bind).toHaveLength(1);
    expect(o.bind[0].keys).toEqual(['<leader>', 'x', 'x']);
    expect(o.bind[0].entry.binding).toEqual({ kind: 'vscode', command: 'workbench.action.quickOpen' });
    expect(o.bind[0].entry.description).toBe('workbench.action.quickOpen');
  });

  it('parses the object form (command + args + description)', () => {
    const o = parseOverrides({
      '<leader>t': { command: 'workbench.action.terminal.sendSequence', args: [{ text: 'htop\n' }], description: 'htop' },
    });
    expect(o.bind[0].entry.binding).toEqual({
      kind: 'vscode',
      command: 'workbench.action.terminal.sendSequence',
      args: [{ text: 'htop\n' }],
    });
    expect(o.bind[0].entry.description).toBe('htop');
  });

  it('false/null means unbind', () => {
    const o = parseOverrides({ '<leader>e': false, '<leader>fn': null });
    expect(o.unbind).toEqual([
      ['<leader>', 'e'],
      ['<leader>', 'f', 'n'],
    ]);
    expect(o.bind).toHaveLength(0);
  });

  it('skips invalid keys and malformed values silently', () => {
    const o = parseOverrides({
      '<notvalid': 'x',
      '<leader>ok': { noCommand: true },
      '<leader>ok2': '',
      '<leader>good': 'undo',
    });
    expect(o.bind).toHaveLength(1);
    expect(o.bind[0].entry.binding).toEqual({ kind: 'vscode', command: 'undo' });
  });
});

describe('mergeKeymapOverrides', () => {
  const base = parsedKeymaps();

  it('unbind removes default bindings', () => {
    const merged = mergeKeymapOverrides(base, parseOverrides({ '<leader>e': false }));
    expect(merged.some((e) => e.keys.join('') === '<leader>e')).toBe(false);
    // everything else intact
    expect(merged.length).toBe(base.length - 1);
  });

  it('bind replaces a default binding at the same key', () => {
    const merged = mergeKeymapOverrides(
      base,
      parseOverrides({ '<leader>e': { command: 'custom.command', description: 'Custom' } }),
    );
    const entries = merged.filter((e) => e.keys.join('') === '<leader>e');
    expect(entries).toHaveLength(1);
    expect(entries[0].entry.binding).toEqual({ kind: 'vscode', command: 'custom.command' });
  });

  it('bind appends new keys without touching the base', () => {
    const merged = mergeKeymapOverrides(base, parseOverrides({ '<leader>zz': 'undo' }));
    expect(merged.length).toBe(base.length + 1);
    expect(merged[merged.length - 1].keys).toEqual(['<leader>', 'z', 'z']);
  });
});
