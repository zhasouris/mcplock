/**
 * In-process streamable-HTTP MCP fixture server (PLAN Phase 2, commit 1).
 *
 * The shared test double behind every e2e test. It speaks enough of the MCP
 * streamable-HTTP transport for `initialize` + `tools/list`, exposes a scriptable
 * tool set that can be mutated mid-test to simulate drift, and supports cursor
 * pagination. Responses are single `application/json` JSON-RPC messages.
 *
 * Not shipped — lives under test/ and is excluded from product coverage.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

/** A tool the fixture will advertise from `tools/list`. */
export interface FixtureTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

export interface FixtureOptions {
  tools?: FixtureTool[];
  serverVersion?: string;
  /** Tools per `tools/list` page; default: all in one page. */
  pageSize?: number;
}

/** Fault-injection knobs for client/DAST tests. */
export interface FixtureFaults {
  /** Milliseconds to delay each response — drives timeout tests. */
  delayMs: number;
  /** Emit invalid JSON with a 200 — drives malformed-response tests. */
  malformed: boolean;
  /** Response transport: single JSON, or an SSE data frame. */
  responseMode: "json" | "sse";
  /** Override the HTTP status of responses (e.g. 503). */
  statusOverride?: number;
  /** Return a JSON-RPC error from `tools/list`. */
  listError?: { code: number; message: string };
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

const PROTOCOL_VERSION = "2025-06-18";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function readCursor(params: unknown): number {
  if (params !== null && typeof params === "object" && "cursor" in params) {
    const cursor = (params as { cursor?: unknown }).cursor;
    const value =
      typeof cursor === "string"
        ? Number.parseInt(cursor, 10)
        : typeof cursor === "number"
          ? cursor
          : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  return 0;
}

function toMcpTool(tool: FixtureTool): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: tool.name,
    inputSchema: tool.inputSchema ?? { type: "object" },
  };
  if (tool.title !== undefined) out.title = tool.title;
  if (tool.description !== undefined) out.description = tool.description;
  if (tool.outputSchema !== undefined) out.outputSchema = tool.outputSchema;
  if (tool.annotations !== undefined) out.annotations = tool.annotations;
  return out;
}

export class McpFixtureServer {
  private readonly server: Server;
  private port = 0;
  private tools: FixtureTool[];
  private serverVersion: string;
  private pageSize: number;
  private requests = 0;
  private readonly faults: FixtureFaults = {
    delayMs: 0,
    malformed: false,
    responseMode: "json",
  };

  private constructor(server: Server, options: FixtureOptions) {
    this.server = server;
    this.tools = options.tools ?? [];
    this.serverVersion = options.serverVersion ?? "1.0.0";
    this.pageSize = options.pageSize ?? Number.POSITIVE_INFINITY;
    server.on("request", (req, res) => {
      void this.handle(req, res);
    });
  }

  static start(options: FixtureOptions = {}): Promise<McpFixtureServer> {
    return new Promise((resolve) => {
      const server = createServer();
      const fixture = new McpFixtureServer(server, options);
      server.listen(0, "127.0.0.1", () => {
        fixture.port = (server.address() as AddressInfo).port;
        resolve(fixture);
      });
    });
  }

  /** The base MCP endpoint URL. */
  get url(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  /** Total requests received — lets tests assert pagination round-trips. */
  get requestCount(): number {
    return this.requests;
  }

  /** Replace the advertised tool set (mutable mid-test to simulate drift). */
  setTools(tools: FixtureTool[]): void {
    this.tools = tools;
  }

  setServerVersion(version: string): void {
    this.serverVersion = version;
  }

  setPageSize(pageSize: number): void {
    this.pageSize = pageSize;
  }

  /** Inject transport faults for client/DAST tests. */
  setFaults(faults: Partial<FixtureFaults>): void {
    Object.assign(this.faults, faults);
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    this.requests += 1;
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    let message: JsonRpcRequest;
    try {
      message = JSON.parse(await readBody(req)) as JsonRpcRequest;
    } catch {
      this.sendError(res, null, -32700, "Parse error");
      return;
    }

    switch (message.method) {
      case "initialize":
        this.sendResult(res, message.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "mcplock-fixture", version: this.serverVersion },
        });
        return;
      case "notifications/initialized":
        res.writeHead(202);
        res.end();
        return;
      case "tools/list":
        if (this.faults.listError) {
          this.sendError(
            res,
            message.id ?? null,
            this.faults.listError.code,
            this.faults.listError.message,
          );
        } else {
          this.sendResult(res, message.id, this.listTools(message.params));
        }
        return;
      default:
        this.sendError(
          res,
          message.id ?? null,
          -32601,
          `Method not found: ${message.method}`,
        );
    }
  }

  private listTools(params: unknown): Record<string, unknown> {
    const start = readCursor(params);
    const end =
      this.pageSize === Number.POSITIVE_INFINITY
        ? this.tools.length
        : start + this.pageSize;
    const page = this.tools.slice(start, end);

    const result: Record<string, unknown> = { tools: page.map(toMcpTool) };
    if (end < this.tools.length) {
      result.nextCursor = String(end);
    }
    return result;
  }

  private sendResult(
    res: ServerResponse,
    id: string | number | null | undefined,
    result: unknown,
  ): void {
    this.sendJson(res, { jsonrpc: "2.0", id: id ?? null, result });
  }

  private sendError(
    res: ServerResponse,
    id: string | number | null,
    code: number,
    message: string,
  ): void {
    this.sendJson(res, { jsonrpc: "2.0", id, error: { code, message } });
  }

  private sendJson(res: ServerResponse, payload: unknown): void {
    const emit = (): void => {
      if (res.writableEnded || res.destroyed) {
        return;
      }
      try {
        const status = this.faults.statusOverride ?? 200;
        if (this.faults.malformed) {
          res.writeHead(status, { "content-type": "application/json" });
          res.end("{ not json");
          return;
        }
        if (this.faults.responseMode === "sse") {
          res.writeHead(status, { "content-type": "text/event-stream" });
          res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
          return;
        }
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      } catch {
        // Client went away (e.g. timed out and aborted) — nothing to do.
      }
    };

    if (this.faults.delayMs > 0) {
      setTimeout(emit, this.faults.delayMs).unref();
    } else {
      emit();
    }
  }
}
