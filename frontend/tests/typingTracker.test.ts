/**
 * Tests for the TypingTracker (extracted from useWebSocketEvents as part of
 * ARC-018). The tracker owns the min-duration typing timer state machine; these
 * tests pin its observable behavior using fake timers so we don't depend on
 * real wall-clock delays.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MIN_TYPING_DURATION_MS, TypingTracker } from "@/systems/typingTracker";

describe("TypingTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns typing on immediately for pre_tool_use", () => {
    const calls: Array<{ key: string; typing: boolean }> = [];
    const tracker = new TypingTracker((key, typing) =>
      calls.push({ key, typing }),
    );

    tracker.onPreToolUse("agent-1");

    expect(calls).toEqual([{ key: "agent-1", typing: true }]);
  });

  it("turns typing off immediately on post_tool_use once min duration has elapsed", () => {
    const calls: Array<{ key: string; typing: boolean }> = [];
    const tracker = new TypingTracker((key, typing) =>
      calls.push({ key, typing }),
    );

    tracker.onPreToolUse("boss");
    // Advance past the minimum duration.
    vi.advanceTimersByTime(MIN_TYPING_DURATION_MS + 10);
    tracker.onPostToolUse("boss");

    expect(calls).toEqual([
      { key: "boss", typing: true },
      { key: "boss", typing: false },
    ]);
  });

  it("schedules the typing-off callback for the remaining duration when post fires early", () => {
    const calls: Array<{ key: string; typing: boolean }> = [];
    const tracker = new TypingTracker((key, typing) =>
      calls.push({ key, typing }),
    );

    tracker.onPreToolUse("agent-1");
    // Only 100ms of the 500ms minimum elapses before post_tool_use.
    vi.advanceTimersByTime(100);
    tracker.onPostToolUse("agent-1");

    // No immediate off — we're still inside the min window.
    expect(calls).toEqual([{ key: "agent-1", typing: true }]);

    // Advance the remaining 400ms; the scheduled callback fires.
    vi.advanceTimersByTime(400);
    expect(calls).toEqual([
      { key: "agent-1", typing: true },
      { key: "agent-1", typing: false },
    ]);
  });

  it("cancels a pending off-timeout if a new pre_tool_use arrives first", () => {
    const calls: Array<{ key: string; typing: boolean }> = [];
    const tracker = new TypingTracker((key, typing) =>
      calls.push({ key, typing }),
    );

    tracker.onPreToolUse("agent-1");
    vi.advanceTimersByTime(100);
    tracker.onPostToolUse("agent-1"); // schedules off at +400ms
    tracker.onPreToolUse("agent-1"); // cancels pending off, re-arms on

    // Advance well past the original 400ms window — the cancelled callback
    // must NOT fire.
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([
      { key: "agent-1", typing: true },
      { key: "agent-1", typing: true },
    ]);
  });

  it("tracks multiple keys independently", () => {
    const calls: Array<{ key: string; typing: boolean }> = [];
    const tracker = new TypingTracker((key, typing) =>
      calls.push({ key, typing }),
    );

    tracker.onPreToolUse("boss");
    tracker.onPreToolUse("agent-1");
    vi.advanceTimersByTime(MIN_TYPING_DURATION_MS + 1);
    tracker.onPostToolUse("boss");

    expect(calls).toEqual([
      { key: "boss", typing: true },
      { key: "agent-1", typing: true },
      { key: "boss", typing: false },
    ]);
    // agent-1 still on, never received an off callback.
    expect(calls.filter((c) => c.key === "agent-1")).toEqual([
      { key: "agent-1", typing: true },
    ]);
  });

  it("clear() cancels all pending off-timeouts", () => {
    const calls: Array<{ key: string; typing: boolean }> = [];
    const tracker = new TypingTracker((key, typing) =>
      calls.push({ key, typing }),
    );

    tracker.onPreToolUse("boss");
    vi.advanceTimersByTime(50);
    tracker.onPostToolUse("boss"); // schedules off at +450ms
    tracker.clear();

    // Advance past where the scheduled callback would have fired.
    vi.advanceTimersByTime(1000);

    // Only the pre callback's "on" was recorded; the scheduled off was cancelled.
    expect(calls).toEqual([{ key: "boss", typing: true }]);
  });

  it("honors a custom minDurationMs override", () => {
    const calls: Array<{ key: string; typing: boolean }> = [];
    const tracker = new TypingTracker(
      (key, typing) => calls.push({ key, typing }),
      1000,
    );

    tracker.onPreToolUse("agent-1");
    vi.advanceTimersByTime(400);
    tracker.onPostToolUse("agent-1");

    expect(calls).toEqual([{ key: "agent-1", typing: true }]);

    // Remaining duration is 600ms for the custom value (not the default 100ms).
    vi.advanceTimersByTime(599);
    expect(calls).toEqual([{ key: "agent-1", typing: true }]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([
      { key: "agent-1", typing: true },
      { key: "agent-1", typing: false },
    ]);
  });

  it("treats an unknown key in post_tool_use as already past min duration (no throw)", () => {
    const calls: Array<{ key: string; typing: boolean }> = [];
    const tracker = new TypingTracker((key, typing) =>
      calls.push({ key, typing }),
    );

    // post without a preceding pre — start time is unknown.
    expect(() => tracker.onPostToolUse("unknown")).not.toThrow();
    // Falls into the "elapsed = minDuration" branch → immediate off.
    expect(calls).toEqual([{ key: "unknown", typing: false }]);
  });
});
