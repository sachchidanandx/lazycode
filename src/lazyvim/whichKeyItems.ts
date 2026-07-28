import { KeymapEntry } from './keymaps';

export interface WhichKeyItem {
  /** Remaining keys to complete the binding, e.g. "ff" under <leader>. */
  readonly label: string;
  readonly description: string;
}

/**
 * Pure resolver for the which-key popup: given the pending keystrokes and the
 * parsed keymap table, produce the items to display. Headless-testable.
 */
export function buildWhichKeyItems(
  pending: readonly string[],
  keymaps: ReadonlyArray<{ keys: string[]; entry: KeymapEntry }>,
  mode: 'Normal' | 'Insert' | 'Visual' | 'VisualLine' = 'Normal',
): WhichKeyItem[] {
  const items: WhichKeyItem[] = [];
  for (const { keys, entry } of keymaps) {
    if (pending.length >= keys.length) continue; // pending must be a strict prefix
    // KeymapEntry contract: modes defaults to Normal-only.
    const modes = entry.modes ?? (['Normal'] as const);
    if (!modes.includes(mode)) continue;
    let prefixMatch = true;
    for (let i = 0; i < pending.length; i++) {
      if (keys[i] !== pending[i]) {
        prefixMatch = false;
        break;
      }
    }
    if (!prefixMatch) continue;
    items.push({
      label: keys.slice(pending.length).join(''),
      description: entry.description,
    });
  }
  return items.sort((a, b) => a.label.localeCompare(b.label));
}

/** Display string for the popup title, e.g. "<leader> › f". */
export function whichKeyTitle(pending: readonly string[]): string {
  return pending
    .map((k) => (k === '<leader>' ? '<leader>' : k.replace(/^<|>$/g, '')))
    .join(' › ');
}
