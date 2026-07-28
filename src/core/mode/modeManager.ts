export type Mode = 'Normal' | 'Insert' | 'Visual' | 'VisualLine';

/**
 * Legal transitions. Anything not listed is ignored (and logged in dev),
 * which keeps mode bugs contained instead of cascading.
 */
const ALLOWED: Readonly<Record<Mode, readonly Mode[]>> = {
  Normal: ['Insert', 'Visual', 'VisualLine'],
  Insert: ['Normal'],
  Visual: ['Normal', 'Insert', 'VisualLine'],
  VisualLine: ['Normal', 'Insert', 'Visual'],
};

export interface ModeChange {
  readonly from: Mode;
  readonly to: Mode;
}

export type ModeListener = (change: ModeChange) => void;

/**
 * Context keys are pushed to VSCode (`setContext`) via this injected function
 * so the manager itself stays vscode-free.
 */
export type ContextSetter = (key: string, value: unknown) => void;

export class ModeManager {
  private mode: Mode = 'Normal';
  private readonly listeners: ModeListener[] = [];

  constructor(private readonly setContext: ContextSetter = () => {}) {
    this.publishContext();
  }

  get current(): Mode {
    return this.mode;
  }

  is(...modes: Mode[]): boolean {
    return modes.includes(this.mode);
  }

  /** Returns true if the transition happened. */
  transition(to: Mode): boolean {
    if (to === this.mode) return true;
    if (!ALLOWED[this.mode].includes(to)) {
      return false;
    }
    const from = this.mode;
    this.mode = to;
    this.publishContext();
    for (const l of this.listeners) l({ from, to });
    return true;
  }

  onDidChange(listener: ModeListener): void {
    this.listeners.push(listener);
  }

  private publishContext(): void {
    this.setContext('lazycode.mode', this.mode);
  }
}
