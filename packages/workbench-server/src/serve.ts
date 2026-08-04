/**
 * Headless entrypoint: runs the daemon and serves the workbench to a browser
 * you already have open.
 *
 * The desktop build pays for an Electron main process, a GPU process, a network
 * service, and a dedicated renderer. Reusing an existing browser drops all of
 * them, which is the single largest memory saving available, so this path is
 * first-class rather than a development convenience.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  resolveDataDir,
  storagePaths,
} from "./infrastructure/storage/paths.js";

interface DaemonFile {
  url?: unknown;
  stale?: unknown;
}

const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 100;

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

/**
 * Reads the daemon descriptor the server writes once it is listening. It is
 * also the handshake the Vite dev server and desktop shell use, so a fresh
 * entry is the authoritative "ready" signal.
 */
async function readDaemonUrl(daemonPath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(daemonPath, "utf8");
    const daemon = JSON.parse(raw) as DaemonFile;
    return typeof daemon.url === "string" && daemon.stale !== true
      ? daemon.url
      : undefined;
  } catch {
    return undefined;
  }
}

async function waitForDaemonUrl(
  daemonPath: string,
  startedAt: number,
): Promise<string | undefined> {
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    const url = await readDaemonUrl(daemonPath);
    if (url) return url;
    await delay(POLL_INTERVAL_MS);
  }
  return undefined;
}

function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {
    console.error(
      "Could not open a browser automatically; open the URL above.",
    );
  });
  child.unref();
}

async function announce(): Promise<void> {
  const paths = storagePaths(resolveDataDir());
  const startedAt = Date.now();

  const url = await waitForDaemonUrl(paths.daemonPath, startedAt);
  if (!url) {
    console.error(
      `Nerve daemon did not report a listening address within ${READY_TIMEOUT_MS / 1000}s.`,
    );
    return;
  }

  // The token query parameter is exchanged for a session cookie on first load,
  // so the printed URL is single-use in the address bar but the session sticks.
  let authenticatedUrl = url;
  try {
    const token = (await readFile(paths.localTokenPath, "utf8")).trim();
    if (token) {
      const withToken = new URL(url);
      withToken.searchParams.set("token", token);
      authenticatedUrl = withToken.toString();
    }
  } catch {
    // Without a local token the daemon is not enforcing loopback auth.
  }

  console.log("");
  console.log("  Nerve is running headless (no Electron).");
  console.log("");
  console.log(`  Open:  ${authenticatedUrl}`);
  console.log(`  Data:  ${paths.home}`);
  console.log("");
  console.log("  Press Ctrl+C to stop.");
  console.log("");

  if (!hasFlag("--no-open")) openInBrowser(authenticatedUrl);
}

// Importing main starts the daemon; announcing runs alongside it so the URL is
// printed as soon as the listener is up.
void announce();
await import("./main.js");
