/**
 * Mock OAuth token endpoint + GitHub-Actions OIDC id-token endpoint, for the
 * oauth provider tests. Serves:
 *   POST /token  — RFC 6749 token response (scriptable success/error);
 *   GET  /oidc   — GitHub OIDC id-token endpoint, returns { value: <jwt> }.
 * Captures the last token-request form params and each OIDC request so tests
 * can assert which credential (secret vs assertion) was sent.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export interface OidcRequest {
  url: string;
  authorization: string | undefined;
}

export class MockOAuthServer {
  private readonly server: Server;
  private port = 0;
  private accessToken = "access-abc";
  private expiresIn = 3600;
  private tokenError: { status: number; body: string } | undefined;
  private oidcJwt = "gh-oidc-jwt";
  private oidcResponse: { status: number; body: string } | undefined;
  private readonly tokenRequests: Record<string, string>[] = [];
  private readonly oidcRequests: OidcRequest[] = [];

  private constructor(server: Server) {
    this.server = server;
    server.on("request", (req, res) => {
      void this.handle(req, res);
    });
  }

  static start(): Promise<MockOAuthServer> {
    return new Promise((resolve) => {
      const server = createServer();
      const mock = new MockOAuthServer(server);
      server.listen(0, "127.0.0.1", () => {
        mock.port = (server.address() as AddressInfo).port;
        resolve(mock);
      });
    });
  }

  get tokenUrl(): string {
    return `http://127.0.0.1:${this.port}/token`;
  }

  get oidcUrl(): string {
    return `http://127.0.0.1:${this.port}/oidc`;
  }

  get tokenRequestCount(): number {
    return this.tokenRequests.length;
  }

  get lastTokenRequest(): Record<string, string> | undefined {
    return this.tokenRequests.at(-1);
  }

  get lastOidcRequest(): OidcRequest | undefined {
    return this.oidcRequests.at(-1);
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  setExpiresIn(seconds: number): void {
    this.expiresIn = seconds;
  }

  setOidcJwt(jwt: string): void {
    this.oidcJwt = jwt;
  }

  /** Force the /oidc response (for OIDC error-path tests). */
  setOidcResponse(status: number, body: string): void {
    this.oidcResponse = { status, body };
  }

  /** Force the /token response (also used for missing-access_token via 200). */
  setTokenResponse(status: number, body: string): void {
    this.tokenError = { status, body };
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
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);

    if (url.pathname === "/oidc") {
      this.oidcRequests.push({
        url: req.url ?? "",
        authorization: req.headers.authorization,
      });
      if (this.oidcResponse) {
        res.writeHead(this.oidcResponse.status, {
          "content-type": "application/json",
        });
        res.end(this.oidcResponse.body);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ value: this.oidcJwt }));
      return;
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const body = await readBody(req);
      this.tokenRequests.push(Object.fromEntries(new URLSearchParams(body)));
      if (this.tokenError) {
        res.writeHead(this.tokenError.status, {
          "content-type": "application/json",
        });
        res.end(this.tokenError.body);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: this.accessToken,
          token_type: "Bearer",
          expires_in: this.expiresIn,
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  }
}
