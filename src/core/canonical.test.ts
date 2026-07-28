import { describe, expect, it } from "vitest";

import { canonicalize, CanonicalizationError } from "./canonical";

// Built from char codes so the source file contains no literal control
// characters and no backslash escapes to be mangled — only printable ASCII.
const BS = String.fromCharCode(0x5c); // backslash
const TAB = String.fromCharCode(0x09);
const NL = String.fromCharCode(0x0a);
const CR = String.fromCharCode(0x0d);
const NUL = String.fromCharCode(0x00);
const C1 = String.fromCharCode(0x80); // a C1 control (>= 0x20 => emitted literally)
// Precomposed single code points (avoid NFC/NFD ambiguity from literals).
const EUR = String.fromCharCode(0x20ac); // €
const ODIA = String.fromCharCode(0x00f6); // ö
const HEB = String.fromCharCode(0xfb33); // Hebrew dalet with dagesh (precomposed)

describe("scalars", () => {
  it("serializes primitives", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
    expect(canonicalize("hi")).toBe('"hi"');
  });
});

describe("key ordering", () => {
  it("sorts object keys", () => {
    expect(canonicalize({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it("sorts integer-like keys by code unit, not numeric value", () => {
    // The JS-object trap: as an object these would reorder to 1,2,10.
    expect(canonicalize({ "10": 1, "2": 2, "1": 3 })).toBe(
      '{"1":3,"10":1,"2":2}',
    );
  });

  it("sorts recursively", () => {
    expect(canonicalize({ b: { z: 1, a: 2 }, a: [3, 1, 2] })).toBe(
      '{"a":[3,1,2],"b":{"a":2,"z":1}}',
    );
  });

  it("is order-independent for equal inputs", () => {
    const one = canonicalize({ x: 1, y: { p: 1, q: 2 } });
    const two = canonicalize({ y: { q: 2, p: 1 }, x: 1 });
    expect(one).toBe(two);
  });
});

describe("strings and unicode (RFC 8785 Appendix B)", () => {
  it("canonicalizes the reference object", () => {
    const input: Record<string, string> = {
      [EUR]: "Euro Sign",
      [CR]: "Carriage Return",
      [NL]: "Newline",
      "1": "One",
      [C1]: "Control",
      [ODIA]: "Latin Small Letter O With Diaeresis",
      [HEB]: "Hebrew Letter Dalet With Dagesh",
      "</script>": "Browser Challenge",
    };
    const expected =
      "{" +
      `"${BS}n":"Newline",` + // U+000A key -> short escape
      `"${BS}r":"Carriage Return",` + // U+000D key -> short escape
      '"1":"One",' +
      '"</script>":"Browser Challenge",' + // '/' and '<' not escaped
      `"${C1}":"Control",` + // C1 control emitted literally
      `"${ODIA}":"Latin Small Letter O With Diaeresis",` +
      `"${EUR}":"Euro Sign",` +
      `"${HEB}":"Hebrew Letter Dalet With Dagesh"` +
      "}";
    expect(canonicalize(input)).toBe(expected);
  });

  it("uses short escapes for control chars and leaves non-ASCII literal", () => {
    expect(canonicalize(`a${TAB}b`)).toBe(`"a${BS}tb"`);
    expect(canonicalize(NUL)).toBe(`"${BS}u0000"`);
    expect(canonicalize(`quote " and ${BS} backslash`)).toBe(
      `"quote ${BS}" and ${BS}${BS} backslash"`,
    );
    expect(canonicalize("café €")).toBe('"café €"');
  });
});

describe("numbers (ECMAScript serialization)", () => {
  it.each([
    [0, "0"],
    [-0, "0"],
    [1, "1"],
    [-1, "-1"],
    [1.5, "1.5"],
    [100, "100"],
    [1000000, "1000000"],
    [1e21, "1e+21"],
    [1e-7, "1e-7"],
    [1e20, "100000000000000000000"],
  ])("serializes %d as %s", (input, expected) => {
    expect(canonicalize(input)).toBe(expected);
  });

  it("serializes numbers nested in structures", () => {
    expect(canonicalize({ a: 1e21, b: [1.5, -0] })).toBe(
      '{"a":1e+21,"b":[1.5,0]}',
    );
  });
});

describe("arrays", () => {
  it("preserves element order (arrays are not sorted)", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("turns undefined holes into null, like JSON.stringify", () => {
    expect(canonicalize([1, undefined, 2])).toBe("[1,null,2]");
  });
});

describe("objects with absent values", () => {
  it("drops undefined-valued properties", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("rejections", () => {
  it.each([NaN, Infinity, -Infinity])(
    "throws on the non-finite number %d",
    (value) => {
      expect(() => canonicalize(value)).toThrow(CanonicalizationError);
    },
  );

  it("throws on a bigint value", () => {
    expect(() => canonicalize({ n: 1n })).toThrow(CanonicalizationError);
  });

  it("throws on top-level undefined", () => {
    expect(() => canonicalize(undefined)).toThrow(CanonicalizationError);
  });
});
