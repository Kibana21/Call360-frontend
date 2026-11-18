// S1-E.2 preflight: stale provider audio is never played after an interruption (browser side of the barge-in rule).
import { describe, expect, it } from 'vitest';
import { playable } from './useVoiceSession';

describe('playable', () => {
  it('plays only the current, uncleared response', () => {
    const cleared = new Set<number>();
    expect(playable(1, 1, cleared)).toBe(true);
    cleared.add(1); // playback.clear for response 1 (interruption)
    expect(playable(1, 1, cleared)).toBe(false); // in-flight frames of the interrupted response are dropped
    expect(playable(1, 2, cleared)).toBe(false); // and stay dropped once the next response starts
    expect(playable(2, 2, cleared)).toBe(true); // the new response plays
    expect(playable(3, 2, cleared)).toBe(false); // frames ahead of their response.started are not played either
  });
});
