import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const peerSource = readFileSync(
  new URL("../src/components/command/CommandCenterPeer.tsx", import.meta.url),
  "utf8",
);

describe("Command Center peer layout", () => {
  it("stacks the todo progress directly below the agent nameplate", () => {
    expect(peerSource).toContain("const NAMEPLATE_Y = -BODY_H - 22;");
    expect(peerSource).toContain("const TODO_PROGRESS_Y = NAMEPLATE_Y + 9;");
    expect(peerSource).toContain("<pixiContainer y={NAMEPLATE_Y} scale={0.5}>");
    expect(peerSource).toContain("<pixiContainer y={TODO_PROGRESS_Y}>");
    expect(peerSource).toContain("<pixiContainer y={8}>");
    expect(peerSource).not.toContain("<pixiContainer y={12}>");
  });
});
