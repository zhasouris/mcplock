import { describe, expect, it } from "vitest";

import {
  loadManifest,
  ManifestError,
  parseManifest,
  type Manifest,
} from "./manifest";

const VALID_FIXTURE = "test/fixtures/manifest/valid.yaml";
const BROKEN_YAML_FIXTURE = "test/fixtures/manifest/broken-yaml.yaml";

/** Minimal valid manifest object; spread + override to build invalid cases. */
function baseManifest(): unknown {
  return {
    version: 1,
    sources: [
      {
        name: "contracts-api",
        url: "https://mcp.internal.example/contracts",
      },
    ],
    tools: [{ name: "contracts.list_expiring", source: "contracts-api" }],
  };
}

describe("loadManifest", () => {
  it("reads, parses, and validates a well-formed manifest", () => {
    const manifest: Manifest = loadManifest(VALID_FIXTURE);
    expect(manifest.version).toBe(1);
    expect(manifest.sources).toHaveLength(2);
    expect(manifest.tools).toHaveLength(2);
    expect(manifest.codegen?.namespace).toBe("acme/agents");
  });

  it("applies documented defaults", () => {
    const manifest = loadManifest(VALID_FIXTURE);
    const billing = manifest.sources[1];
    // type + auth omitted in the fixture
    expect(billing?.type).toBe("direct");
    expect(billing?.auth).toBe("none");
    // constraint omitted on the second tool
    expect(manifest.tools[1]?.constraint).toBe("*");
  });

  it("wraps a missing file as ManifestError", () => {
    expect(() =>
      loadManifest("test/fixtures/manifest/does-not-exist.yaml"),
    ).toThrow(ManifestError);
  });

  it("wraps malformed YAML as ManifestError", () => {
    expect(() => loadManifest(BROKEN_YAML_FIXTURE)).toThrow(/not valid YAML/);
  });
});

describe("parseManifest", () => {
  it("accepts a minimal valid manifest and defaults tools to []", () => {
    const manifest = parseManifest({
      version: 1,
      sources: [{ name: "s1", url: "https://example.com/s1" }],
    });
    expect(manifest.tools).toEqual([]);
  });

  it("accepts ${env:VAR} header values", () => {
    const raw = baseManifest() as { sources: { headers?: unknown }[] };
    raw.sources[0]!.headers = { Authorization: "${env:TOKEN}" };
    expect(() => parseManifest(raw)).not.toThrow();
  });

  it("accepts the reserved dotnet codegen target (errors only at use)", () => {
    const raw = baseManifest() as Record<string, unknown>;
    raw.codegen = { target: "dotnet" };
    expect(() => parseManifest(raw)).not.toThrow();
  });

  it("accepts the oauth-client-credentials object auth form", () => {
    const raw = baseManifest() as { sources: Record<string, unknown>[] };
    raw.sources[0]!.auth = {
      type: "oauth-client-credentials",
      tokenUrl: "https://login.example.com/token",
      clientId: "cid",
      assertion: "oidc",
    };
    expect(() => parseManifest(raw)).not.toThrow();
  });

  describe("rejects", () => {
    it("an oauth auth object missing tokenUrl", () => {
      const raw = baseManifest() as { sources: Record<string, unknown>[] };
      raw.sources[0]!.auth = {
        type: "oauth-client-credentials",
        clientId: "cid",
      };
      expect(() => parseManifest(raw)).toThrow(ManifestError);
    });

    it("an oauth auth object with an unknown key", () => {
      const raw = baseManifest() as { sources: Record<string, unknown>[] };
      raw.sources[0]!.auth = {
        type: "oauth-client-credentials",
        tokenUrl: "https://login.example.com/token",
        clientId: "cid",
        oops: true,
      };
      expect(() => parseManifest(raw)).toThrow(ManifestError);
    });

    it("the wrong version", () => {
      const raw = baseManifest() as Record<string, unknown>;
      raw.version = 2;
      expect(() => parseManifest(raw)).toThrow(ManifestError);
    });

    it("empty sources", () => {
      const raw = baseManifest() as Record<string, unknown>;
      raw.sources = [];
      expect(() => parseManifest(raw)).toThrow(/at least one source/);
    });

    it("an unknown top-level key", () => {
      const raw = baseManifest() as Record<string, unknown>;
      raw.extra = true;
      expect(() => parseManifest(raw)).toThrow(ManifestError);
    });

    it("an unknown source key", () => {
      const raw = baseManifest() as { sources: Record<string, unknown>[] };
      raw.sources[0]!.oops = true;
      expect(() => parseManifest(raw)).toThrow(ManifestError);
    });

    it("a bad auth type", () => {
      const raw = baseManifest() as { sources: Record<string, unknown>[] };
      raw.sources[0]!.auth = "kerberos";
      expect(() => parseManifest(raw)).toThrow(ManifestError);
    });

    it("a source name that is not [a-z0-9-]+", () => {
      const raw = baseManifest() as { sources: Record<string, unknown>[] };
      raw.sources[0]!.name = "Contracts_API";
      expect(() => parseManifest(raw)).toThrow(/\[a-z0-9-\]/);
    });

    it("a non-URL source url", () => {
      const raw = baseManifest() as { sources: Record<string, unknown>[] };
      raw.sources[0]!.url = "not-a-url";
      expect(() => parseManifest(raw)).toThrow(ManifestError);
    });

    it("a literal (non-interpolated) header value", () => {
      const raw = baseManifest() as { sources: { headers?: unknown }[] };
      raw.sources[0]!.headers = { Authorization: "Bearer sk-literal-secret" };
      expect(() => parseManifest(raw)).toThrow(/env:VAR/);
    });

    it("duplicate source names", () => {
      const raw = baseManifest() as { sources: unknown[] };
      raw.sources.push({
        name: "contracts-api",
        url: "https://example.com/dupe",
      });
      expect(() => parseManifest(raw)).toThrow(/duplicate source/);
    });

    it("a tool that references an undeclared source", () => {
      const raw = baseManifest() as { tools: { source: string }[] };
      raw.tools[0]!.source = "ghost-api";
      expect(() => parseManifest(raw)).toThrow(/unknown source "ghost-api"/);
    });
  });
});
