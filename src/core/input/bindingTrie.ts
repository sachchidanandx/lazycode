/**
 * BindingTrie: stores key-sequence → binding mappings and answers the only
 * question the router cares about: given the keys pressed SO FAR, is this
 *   - a complete match (fire it),
 *   - a prefix of something longer (wait for more / timeout),
 *   - or nothing (flush, maybe fall through to default handling)?
 *
 * This is what makes counts ("3dw") and multi-key sequences ("gg", "<leader>ff")
 * composable without hardcoding pairs.
 */

export type MatchResult<T> =
  | { type: 'match'; value: T }
  | { type: 'partial' }
  | { type: 'none' };

interface Node<T> {
  children: Map<string, Node<T>>;
  value?: T;
}

const newNode = <T>(): Node<T> => ({ children: new Map() });

export class BindingTrie<T> {
  private readonly root = newNode<T>();

  bind(keys: readonly string[], value: T): void {
    if (keys.length === 0) throw new Error('cannot bind empty sequence');
    let node = this.root;
    for (const key of keys) {
      let child = node.children.get(key);
      if (!child) {
        child = newNode<T>();
        node.children.set(key, child);
      }
      node = child;
    }
    node.value = value;
  }

  unbind(keys: readonly string[]): boolean {
    const path: Node<T>[] = [this.root];
    for (const key of keys) {
      const next = path[path.length - 1].children.get(key);
      if (!next) return false;
      path.push(next);
    }
    const leaf = path[path.length - 1];
    if (leaf.value === undefined) return false;
    delete leaf.value;
    // prune empty branches
    for (let i = keys.length - 1; i >= 0; i--) {
      const node = path[i + 1];
      if (node.children.size > 0 || node.value !== undefined) break;
      path[i].children.delete(keys[i]);
    }
    return true;
  }

  match(keys: readonly string[]): MatchResult<T> {
    let node = this.root;
    for (const key of keys) {
      const next = node.children.get(key);
      if (!next) return { type: 'none' };
      node = next;
    }
    if (node.value !== undefined) return { type: 'match', value: node.value };
    return node.children.size > 0 ? { type: 'partial' } : { type: 'none' };
  }

  /** All bindings under a prefix — used by the which-key popup. */
  bindingsWithPrefix(prefix: readonly string[]): Array<{ keys: string[]; value: T }> {
    let node = this.root;
    for (const key of prefix) {
      const next = node.children.get(key);
      if (!next) return [];
      node = next;
    }
    const out: Array<{ keys: string[]; value: T }> = [];
    const walk = (n: Node<T>, acc: string[]): void => {
      if (n.value !== undefined) out.push({ keys: [...acc], value: n.value });
      for (const [k, child] of n.children) walk(child, [...acc, k]);
    };
    walk(node, [...prefix]);
    return out;
  }

  get size(): number {
    return this.bindingsWithPrefix([]).length;
  }
}
