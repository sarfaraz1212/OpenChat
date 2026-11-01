import type { Sandbox } from "@cloudflare/sandbox"
import { getSandbox } from "@cloudflare/sandbox"
import type { AppBindings } from "../../env"

/** The one directory a sandbox session works in; tools are confined to it. */
export const SANDBOX_ROOT = "/workspace"

export type ExecResult = { stdout: string; stderr: string; exitCode: number }

export type FileEntry = {
  name: string
  type: "file" | "directory" | "other"
  size: number
}

/**
 * What the app needs from a sandbox: run a command, and read, write and list
 * files. Deliberately small so the backend is easy to swap or fake; everything
 * else (edit, code execution) is built on these.
 */
export interface SandboxSession {
  exec(command: string, options?: { timeoutMs?: number }): Promise<ExecResult>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  listFiles(path: string): Promise<FileEntry[]>
}

/** Opens (creating on first use) the sandbox with this id. */
export type SandboxProvider = (sandboxId: string) => SandboxSession

/** The Cloudflare Sandbox SDK (a Durable Object plus a container) behind our interface. */
function cloudflareSession(
  namespace: DurableObjectNamespace<Sandbox>,
  sandboxId: string
): SandboxSession {
  const sandbox = getSandbox(namespace, sandboxId, { normalizeId: true })
  return {
    async exec(command, options) {
      const result = await sandbox.exec(command, {
        cwd: SANDBOX_ROOT,
        timeout: options?.timeoutMs,
      })
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    },
    async readFile(path) {
      return (await sandbox.readFile(path)).content
    },
    async writeFile(path, content) {
      await sandbox.writeFile(path, content)
    },
    async listFiles(path) {
      const { files } = await sandbox.listFiles(path)
      return files.map((file) => ({
        name: file.name,
        type:
          file.type === "file" || file.type === "directory"
            ? file.type
            : "other",
        size: file.size,
      }))
    },
  }
}

/**
 * The sandbox backend for this Worker, or null when none is configured (the
 * Sandbox binding needs a container image; see DEPLOY.md). `SANDBOX_BACKEND`
 * is a test-only replacement, like `AI_FETCH`.
 */
export function sandboxProvider(env: AppBindings): SandboxProvider | null {
  if (env.SANDBOX_BACKEND) return env.SANDBOX_BACKEND
  const namespace = env.SANDBOX
  return namespace ? (id) => cloudflareSession(namespace, id) : null
}
