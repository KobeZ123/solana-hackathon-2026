import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  canonicalMetadataJson,
  metadataHashBytes,
  metadataHashHex,
} from "./metadata";

describe("canonical metadata hash", () => {
  it("sorts keys recursively and omits whitespace", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: null }] })).toBe(
      '{"a":[2,{"c":null,"d":1}],"b":1}'
    );
    expect(
      canonicalMetadataJson({
        title: "A",
        details: { b: 1, a: [2] },
      })
    ).toBe(
      '{"coverUrl":null,"details":{"a":[2],"b":1},"summary":"","title":"A"}'
    );
  });

  it("is independent of key insertion order", async () => {
    const a = await metadataHashHex({
      title: "T",
      summary: "S",
      coverUrl: null,
      details: { x: 1, y: { p: 1, q: 2 } },
    });
    const b = await metadataHashHex({
      details: { y: { q: 2, p: 1 }, x: 1 },
      coverUrl: null,
      summary: "S",
      title: "T",
    });
    expect(a).toBe(b);
  });

  it("treats missing coverUrl as null and missing summary as empty", async () => {
    expect(await metadataHashHex({ title: "T", details: {} })).toBe(
      await metadataHashHex({
        title: "T",
        summary: "",
        coverUrl: null,
        details: {},
      })
    );
  });

  it("changes when any field changes", async () => {
    const base = {
      title: "T",
      summary: "S",
      coverUrl: null,
      details: { a: 1 },
    };
    const h = await metadataHashHex(base);
    for (const m of [
      { ...base, title: "T2" },
      { ...base, summary: "S2" },
      { ...base, coverUrl: "https://x.y/z.png" },
      { ...base, details: { a: 2 } },
    ]) {
      expect(await metadataHashHex(m)).not.toBe(h);
    }
  });

  it("matches a known sha256 vector (UTF-8, 32 bytes, lowercase hex)", async () => {
    const meta = { title: "é", summary: "", coverUrl: null, details: {} };
    const expected = (await import("node:crypto"))
      .createHash("sha256")
      .update('{"coverUrl":null,"details":{},"summary":"","title":"é"}', "utf8")
      .digest("hex");
    expect(await metadataHashHex(meta)).toBe(expected);
    expect(await metadataHashBytes(meta)).toHaveLength(32);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});
