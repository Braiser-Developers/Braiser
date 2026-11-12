import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ClientConfig } from "./config.js";

export function validateToken(value: string): string {
  const token = value.trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error("Braiser token must contain 32–256 letters, digits, underscores or hyphens");
  return token;
}

export async function readToken(file: string): Promise<string> {
  try {
    return validateToken(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Braiser token file is missing: ${file}`);
    throw error;
  }
}

async function ensureToken(file: string): Promise<string> {
  try {
    await writeFile(file, `${randomBytes(32).toString("base64url")}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readToken(file);
}

// D-0003: separate credentials let the daemon enforce the remote capability boundary.
export async function localCredentials(stateDir: string): Promise<{ local: string; remote: string }> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const local = await ensureToken(path.join(stateDir, "local-token"));
  const remote = await ensureToken(path.join(stateDir, "remote-token"));
  if (local === remote) throw new Error("Local and remote Braiser tokens must be different");
  return { local, remote };
}

export async function clientToken(config: ClientConfig): Promise<string> {
  if (config.token) return validateToken(config.token);
  if (config.mode === "local" && config.tokenFile === path.join(config.stateDir, "local-token")) {
    return (await localCredentials(config.stateDir)).local;
  }
  if (!config.tokenFile) throw new Error("No Braiser token configured");
  return readToken(config.tokenFile);
}

export function tokenMatches(value: string | undefined, expected: string): boolean {
  if (!value) return false;
  const actual = Buffer.from(value);
  const wanted = Buffer.from(`Bearer ${expected}`);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
