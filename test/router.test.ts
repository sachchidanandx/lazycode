import { describe, it, expect, vi } from 'vitest';
import { BindingTrie } from '../src/core/input/bindingTrie';
import { Binding, KeystrokeRouter } from '../src/core/router';
import { Mode, ModeManager } from '../src/core/mode/modeManager';
import { FakeEditorContext } from './fakeEditorContext';

function setup() {
  const modeManager = new ModeManager();
  const trie = new BindingTrie<Binding>();
  const executeCommand = vi.fn().mockResolvedValue(undefined);
  const defaultType = vi.fn().mockResolvedValue(undefined);
  const router = new KeystrokeRouter({
    modeManager,
    trieForMode: () => trie,
    executeCommand,
    defaultType,
  });
  const editor = new FakeEditorContext('hello world');
  return { modeManager, trie, executeCommand, defaultType, router, editor };
}

describe('KeystrokeRouter', () => {
  it('fires a vscode binding on complete sequence in Normal mode', async () => {
    const { trie, router, executeCommand, editor } = setup();
    trie.bind(['g', 'd'], { kind: 'vscode', command: 'editor.action.revealDefinition' });

    expect(await router.handleKeystroke('g', 'g', editor)).toEqual({ type: 'pending' });
    const result = await router.handleKeystroke('d', 'd', editor);
    expect(result.type).toBe('handled');
    expect(executeCommand).toHaveBeenCalledWith('editor.action.revealDefinition', undefined);
  });

  it('passes unbound keys through to default:type in Insert mode', async () => {
    const { modeManager, router, defaultType, editor } = setup();
    modeManager.transition('Insert');
    const result = await router.handleKeystroke('x', 'x', editor);
    expect(result).toEqual({ type: 'passthrough' });
    expect(defaultType).toHaveBeenCalledWith('x');
  });

  it('fires insert-mode bindings instead of typing (e.g. jk escape)', async () => {
    const { modeManager, trie, router, executeCommand, defaultType, editor } = setup();
    modeManager.transition('Insert');
    trie.bind(['j', 'k'], { kind: 'vscode', command: 'lazycode.enterNormalMode' });

    expect(await router.handleKeystroke('j', 'j', editor)).toEqual({ type: 'pending' });
    const result = await router.handleKeystroke('k', 'k', editor);
    expect(result.type).toBe('handled');
    expect(executeCommand).toHaveBeenCalledWith('lazycode.enterNormalMode', undefined);
    expect(defaultType).not.toHaveBeenCalled();
  });

  it('flushes pending insert keys as text when sequence breaks', async () => {
    const { modeManager, trie, router, defaultType, editor } = setup();
    modeManager.transition('Insert');
    trie.bind(['j', 'k'], { kind: 'vscode', command: 'lazycode.enterNormalMode' });

    await router.handleKeystroke('j', 'j', editor); // pending
    await router.handleKeystroke('a', 'a', editor); // breaks sequence
    expect(defaultType).toHaveBeenCalledWith('j');
    expect(defaultType).toHaveBeenCalledWith('a');
  });

  it('rewrites the physical leader key (<space>) to <leader> at sequence start', async () => {
    const { trie, router, executeCommand, editor } = setup();
    trie.bind(['<leader>', 'f', 'f'], { kind: 'vscode', command: 'workbench.action.quickOpen' });

    expect(await router.handleKeystroke('<space>', ' ', editor)).toEqual({ type: 'pending' });
    await router.handleKeystroke('f', 'f', editor);
    const result = await router.handleKeystroke('f', 'f', editor);
    expect(result.type).toBe('handled');
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.quickOpen', undefined);
  });

  it('does NOT rewrite <space> mid-sequence (so <leader><space> works)', async () => {
    const { trie, router, executeCommand, editor } = setup();
    trie.bind(['<leader>', '<space>'], { kind: 'vscode', command: 'workbench.action.quickOpen' });

    await router.handleKeystroke('<space>', ' ', editor); // → <leader>
    const result = await router.handleKeystroke('<space>', ' ', editor); // stays <space>
    expect(result.type).toBe('handled');
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.quickOpen', undefined);
  });

  it('<space> still types normally in Insert mode', async () => {
    const { modeManager, router, defaultType, editor } = setup();
    modeManager.transition('Insert');
    const result = await router.handleKeystroke('<space>', ' ', editor);
    expect(result).toEqual({ type: 'passthrough' });
    expect(defaultType).toHaveBeenCalledWith(' ');
  });

  it('bypasses the trie when the engine has pending input (f/ finds / instead of opening find)', async () => {
    const modeManager = new ModeManager();
    const trie = new BindingTrie<Binding>();
    trie.bind(['/'], { kind: 'vscode', command: 'actions.find' });
    const executeCommand = vi.fn().mockResolvedValue(undefined);
    const defaultType = vi.fn().mockResolvedValue(undefined);
    const engineFallback = vi.fn().mockResolvedValue(undefined);
    let pending = true; // simulate engine awaiting its find-char argument
    const router = new KeystrokeRouter({
      modeManager,
      trieForMode: () => trie,
      executeCommand,
      defaultType,
      engineFallback,
      engineHasPendingInput: () => pending,
    });
    const editor = new FakeEditorContext('a/b');

    const result = await router.handleKeystroke('/', '/', editor);
    expect(result.type).toBe('handled');
    expect(engineFallback).toHaveBeenCalledWith(['/'], editor);
    expect(executeCommand).not.toHaveBeenCalled(); // find widget did NOT open

    // When the engine is not pending, '/' hits the trie normally.
    pending = false;
    await router.handleKeystroke('/', '/', editor);
    expect(executeCommand).toHaveBeenCalledWith('actions.find', undefined);
  });

  it('does NOT fire Normal-only bindings in Insert mode (typing `n` must not open find)', async () => {
    // Regression: a single shared trie let Normal bindings (n → next match)
    // shadow plain typing in Insert mode. Per-mode tries fix this.
    const modeManager = new ModeManager();
    const normalTrie = new BindingTrie<Binding>();
    normalTrie.bind(['n'], { kind: 'vscode', command: 'editor.action.nextMatchFindAction' });
    const tries = new Map<Mode, BindingTrie<Binding>>([['Normal', normalTrie]]);
    const emptyTrie = new BindingTrie<Binding>();
    const executeCommand = vi.fn().mockResolvedValue(undefined);
    const defaultType = vi.fn().mockResolvedValue(undefined);
    const router = new KeystrokeRouter({
      modeManager,
      trieForMode: (mode) => tries.get(mode) ?? emptyTrie,
      executeCommand,
      defaultType,
    });
    const editor = new FakeEditorContext('hello world');

    modeManager.transition('Insert');
    const result = await router.handleKeystroke('n', 'n', editor);
    expect(result).toEqual({ type: 'passthrough' });
    expect(defaultType).toHaveBeenCalledWith('n');
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('does NOT buffer Normal-mode prefixes in Insert mode (typing `gd` types literally)', async () => {
    const modeManager = new ModeManager();
    const normalTrie = new BindingTrie<Binding>();
    normalTrie.bind(['g', 'd'], { kind: 'vscode', command: 'editor.action.revealDefinition' });
    const tries = new Map<Mode, BindingTrie<Binding>>([['Normal', normalTrie]]);
    const emptyTrie = new BindingTrie<Binding>();
    const executeCommand = vi.fn().mockResolvedValue(undefined);
    const defaultType = vi.fn().mockResolvedValue(undefined);
    const router = new KeystrokeRouter({
      modeManager,
      trieForMode: (mode) => tries.get(mode) ?? emptyTrie,
      executeCommand,
      defaultType,
    });
    const editor = new FakeEditorContext('hello world');

    modeManager.transition('Insert');
    expect(await router.handleKeystroke('g', 'g', editor)).toEqual({ type: 'passthrough' });
    expect(await router.handleKeystroke('d', 'd', editor)).toEqual({ type: 'passthrough' });
    expect(defaultType).toHaveBeenCalledWith('g');
    expect(defaultType).toHaveBeenCalledWith('d');
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('swallows unknown Normal-mode keys (vim behavior)', async () => {
    const { router, defaultType, editor } = setup();
    const result = await router.handleKeystroke('z', 'z', editor);
    expect(result).toEqual({ type: 'handled' });
    expect(defaultType).not.toHaveBeenCalled();
  });
});
