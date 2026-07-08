import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const decorSource = readFileSync(
  new URL("../src/components/command/CommandCenterDecor.tsx", import.meta.url),
  "utf8",
);

const boardSource = readFileSync(
  new URL("../src/components/command/CommandCenterBoard.tsx", import.meta.url),
  "utf8",
);

describe("Command Center wall layout", () => {
  it("uses a single wall photo", () => {
    const photoSprites = decorSource.match(/texture={t\.employeeOfMonth}/g);

    expect(photoSprites).toHaveLength(1);
  });

  it("keeps the summary whiteboard readable", () => {
    expect(boardSource).toContain("const W = 320;");
    expect(boardSource).toContain("const H = 116;");
  });
});
