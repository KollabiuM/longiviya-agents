/**
 * ARC-020 (plugin part): resolveApiUrl applies the same loopback clamp +
 * CLAUDE_OFFICE_ALLOW_REMOTE opt-in as the hooks' config._resolve_api_url,
 * so both producers treat CLAUDE_OFFICE_API_URL identically.
 */
import { describe, it, expect } from "bun:test";
import { resolveApiUrl } from "../src/index";

describe("ARC-020 resolveApiUrl (loopback clamp + opt-in remote)", () => {
  const noClamp = (host: string): void => {
    throw new Error(`expected no clamp, but got ${host}`);
  };

  it("passes localhost through unchanged", () => {
    const url = "http://localhost:8000/api/v1/events";
    expect(resolveApiUrl(url, false, noClamp)).toBe(url);
  });

  it("passes 127.0.0.1 and ::1 through unchanged", () => {
    expect(
      resolveApiUrl("http://127.0.0.1:8000/api/v1/events", false, noClamp),
    ).toBe("http://127.0.0.1:8000/api/v1/events");
    expect(
      resolveApiUrl("http://[::1]:8000/api/v1/events", false, noClamp),
    ).toBe("http://[::1]:8000/api/v1/events");
  });

  it("clamps a remote URL to the local default when allowRemote is false", () => {
    const clamped: string[] = [];
    const result = resolveApiUrl(
      "https://office.example.com/api/v1/events",
      false,
      (h) => {
        clamped.push(h);
      },
    );
    expect(result).toBe("http://localhost:8000/api/v1/events");
    expect(clamped).toEqual(["office.example.com"]);
  });

  it("honors a remote URL when allowRemote is true", () => {
    const clamped: string[] = [];
    const remote = "https://office.example.com/api/v1/events";
    expect(
      resolveApiUrl(remote, true, (h) => {
        clamped.push(h);
      }),
    ).toBe(remote);
    expect(clamped).toEqual([]);
  });
});
