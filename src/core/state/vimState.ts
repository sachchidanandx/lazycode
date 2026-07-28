import { Mode } from '../mode/modeManager';

/**
 * VimState: the data threaded through every keystroke handling cycle.
 *
 * Design rule (learned from VSCodeVim): actions are pure-ish functions
 *   (state, editor) => newState + edits
 * which makes them replayable — that's what `.` repeat and macros are built on.
 */
export interface VimState {
  readonly mode: Mode;

  /** Keystrokes accumulated toward a pending binding (e.g. ["g"] before the second "g"). */
  readonly pendingKeys: readonly string[];

  /** Count typed before an operator ("3" in "3dw") and before a motion ("5" in "5j"). */
  readonly operatorCount: number | undefined;
  readonly motionCount: number | undefined;

  /** The operator waiting for a motion/text-object ("d" after pressing d in Normal). */
  readonly pendingOperator: string | undefined;

  /** Last change, recorded for `.` repeat. Filled in Milestone 2. */
  readonly lastChange: readonly string[] | undefined;

  /** Named registers "a-z plus "0 (yank) and unnamed. Filled in Milestone 2. */
  readonly registers: Readonly<Record<string, string>>;
}

export function initialVimState(): VimState {
  return {
    mode: 'Normal',
    pendingKeys: [],
    operatorCount: undefined,
    motionCount: undefined,
    pendingOperator: undefined,
    lastChange: undefined,
    registers: {},
  };
}

/** Effective count: operatorCount * motionCount, defaulting each to 1. */
export function effectiveCount(state: VimState): number {
  return (state.operatorCount ?? 1) * (state.motionCount ?? 1);
}

export function clearPending(state: VimState): VimState {
  return {
    ...state,
    pendingKeys: [],
    operatorCount: undefined,
    motionCount: undefined,
    pendingOperator: undefined,
  };
}
