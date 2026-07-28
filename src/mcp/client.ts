/**
 * Streamable-HTTP MCP client (PLAN Phase 2, commit 2).
 *
 * mcplock only ever lists tools — it never invokes them (README "What it is
 * not", spec §8). This client does the `initialize` handshake, sends the
 * `notifications/initialized` notification, then pages through `tools/list`,
 * returning tool definitions plus the server version. It handles both
 * `application/json` and `text/event-stream` responses, and enforces a
 * per-request timeout. Every failure surfaces as an {@link McpError} naming the
 * server (maps to exit 3).
 */
import type { ToolDefinition } from "../core/hash";

const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface McpClientOptions {
  url: string;
  /** Extra request headers (auth). */
  headers?: Record<string, string>;
  /** Per-request timeout; default 30s. */
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
}

export interface ListToolsResult {
  serverVersion?: string;
  tools: ToolDefinition[];
}

/** Any transport, protocol, or timeout failure while listing tools. */
export class McpError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "McpError";
  }
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function toToolDefinition(raw: unknown): ToolDefinition {
  if (raw === null || typeof raw !== "object") {
    throw new McpError("malformed tool in tools/list (not an object)");
  }
  const tool = raw as Record<string, unknown>;
  if (typeof tool.name !== "string") {
    throw new McpError("malformed tool in tools/list (missing name)");
  }
  const def: ToolDefinition = { name: tool.name };
  if (typeof tool.title === "string") def.title = tool.title;
  if (typeof tool.description === "string") def.description = tool.description;
  if ("inputSchema" in tool) def.inputSchema = tool.inputSchema;
  if ("outputSchema" in tool) def.outputSchema = tool.outputSchema;
  if ("annotations" in tool) def.annotations = tool.annotations;
  return def;
}

export class McpClient {
  private readonly url: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private nextId = 1;

  constructor(options: McpClientOptions) {
    this.url = options.url;
    this.extraHeaders = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.clientName = options.clientName ?? "mcplock";
    this.clientVersion = options.clientVersion ?? "0.0.0";
  }

  /** Handshake, then page through every tool the server advertises. */
  async listTools(): Promise<ListToolsResult> {
    const { sessionId, serverVersion } = await this.initialize();
    await this.notifyInitialized(sessionId);
    const tools = await this.paginateTools(sessionId);
    return serverVersion !== undefined ? { serverVersion, tools } : { tools };
  }

  private async initialize(): Promise<{
    sessionId?: string;
    serverVersion?: string;
  }> {
    const { result, headers } = await this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.clientName, version: this.clientVersion },
    });
    const serverInfo = (result as { serverInfo?: { version?: unknown } })
      .serverInfo;
    const version = serverInfo?.version;
    const sessionId = headers.get("mcp-session-id") ?? undefined;
    return {
      ...(sessionId !== undefined && { sessionId }),
      ...(typeof version === "string" && { serverVersion: version }),
    };
  }

  private async paginateTools(sessionId?: string): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = [];
    let cursor: string | undefined;
    for (;;) {
      const params = cursor !== undefined ? { cursor } : undefined;
      const { result } = await this.rpc("tools/list", params, sessionId);
      const page = result as { tools?: unknown; nextCursor?: unknown };
      const rawTools = Array.isArray(page.tools) ? page.tools : [];
      for (const raw of rawTools) {
        tools.push(toToolDefinition(raw));
      }
      if (typeof page.nextCursor === "string" && page.nextCursor.length > 0) {
        cursor = page.nextCursor;
      } else {
        return tools;
      }
    }
  }

  private buildHeaders(sessionId?: string): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId !== undefined && { "mcp-session-id": sessionId }),
      ...this.extraHeaders,
    };
  }

  private async rpc(
    method: string,
    params?: unknown,
    sessionId?: string,
  ): Promise<{ result: unknown; headers: Headers }> {
    const body = {
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      ...(params !== undefined && { params }),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.buildHeaders(sessionId),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new McpError(`${this.url} returned HTTP ${String(res.status)}`);
      }
      const message = await this.readMessage(res);
      if (message.error) {
        throw new McpError(
          `${method} failed: ${message.error.message} (code ${String(message.error.code)})`,
        );
      }
      return { result: message.result, headers: res.headers };
    } catch (cause) {
      throw this.wrapError(cause, controller);
    } finally {
      clearTimeout(timer);
    }
  }

  private async notifyInitialized(sessionId?: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.buildHeaders(sessionId),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new McpError(`${this.url} returned HTTP ${String(res.status)}`);
      }
      await res.text();
    } catch (cause) {
      throw this.wrapError(cause, controller);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readMessage(res: Response): Promise<JsonRpcResponse> {
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    const payload = contentType.includes("text/event-stream")
      ? this.extractSseData(text)
      : text;
    try {
      return JSON.parse(payload) as JsonRpcResponse;
    } catch (cause) {
      throw new McpError(`malformed JSON-RPC response from ${this.url}`, {
        cause,
      });
    }
  }

  private extractSseData(text: string): string {
    for (const frame of text.split("\n\n")) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("");
      if (data.length > 0) {
        return data;
      }
    }
    throw new McpError(`no data frame in SSE response from ${this.url}`);
  }

  private wrapError(cause: unknown, controller: AbortController): McpError {
    if (cause instanceof McpError) {
      return cause;
    }
    if (controller.signal.aborted) {
      return new McpError(
        `request to ${this.url} timed out after ${String(this.timeoutMs)}ms`,
        { cause },
      );
    }
    return new McpError(`request to ${this.url} failed`, { cause });
  }
}
