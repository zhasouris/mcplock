/**
 * Shared helpers for live tests: spawn a real MCP server (via npx) over its
 * native streamable-HTTP transport and stop it cleanly.
 *
 * npx does not forward signals to the node child it spawns, so servers are
 * started detached and stopped by killing the whole process group — otherwise
 * the old server lingers on the port and the next one cannot bind.
 */
import { spawn, type ChildProcess } from "node:child_process";

export const EVERYTHING = "@modelcontextprotocol/server-everything";
export const PORT = 3001;
export const URL = `http://localhost:${PORT}/mcp`;

const READY = /listening on port/i;

function waitForListen(
  child: ChildProcess,
  label: string,
): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} start timeout`)),
      180_000,
    );
    const onData = (d: Buffer): void => {
      if (READY.test(d.toString())) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${label} exited early (${String(code)})`));
    });
  });
}

/** Start `npx -y <spec> streamableHttp` (native streamable-HTTP server). */
export function startServer(spec: string): Promise<ChildProcess> {
  const child = spawn("npx", ["-y", spec, "streamableHttp"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  return waitForListen(child, `server ${spec}`);
}

/** Bridge a stdio MCP server to streamable-HTTP via supergateway. */
export function startBridge(
  stdioCommand: string,
  port: number,
): Promise<ChildProcess> {
  const child = spawn(
    "npx",
    [
      "-y",
      "supergateway",
      "--stdio",
      stdioCommand,
      "--outputTransport",
      "streamableHttp",
      "--port",
      String(port),
      "--streamableHttpPath",
      "/mcp",
    ],
    { stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  return waitForListen(child, `bridge (${stdioCommand})`);
}

export function bridgeUrl(port: number): string {
  return `http://localhost:${port}/mcp`;
}

export async function stopServer(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    try {
      // Negative pid = kill the whole process group (npx + node child).
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    setTimeout(resolve, 3000);
  });
  await new Promise((r) => setTimeout(r, 1500)); // let the port free
}
