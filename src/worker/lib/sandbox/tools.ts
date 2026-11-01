import { tool } from "ai"
import { z } from "zod"
import { SANDBOX_ROOT, type SandboxSession } from "./backend"

/** Largest stdout/stderr/file text handed back to the model. */
export const MAX_OUTPUT_CHARS = 16_000
export const DEFAULT_TIMEOUT_SECONDS = 30
export const MAX_TIMEOUT_SECONDS = 120
const MAX_LISTED_FILES = 200

/**
 * A path inside the sandbox workspace, or null if it would leave it. Relative
 * paths are relative to the workspace and `..` is resolved lexically. This is
 * a guardrail against the model wandering, not a security boundary: the
 * container is the isolation.
 */
export function resolveSandboxPath(input: string): string | null {
  const absolute = input.startsWith("/") ? input : `${SANDBOX_ROOT}/${input}`
  const parts: string[] = []
  for (const part of absolute.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  const normalized = `/${parts.join("/")}`
  return normalized === SANDBOX_ROOT ||
    normalized.startsWith(`${SANDBOX_ROOT}/`)
    ? normalized
    : null
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const truncate = (text: string) =>
  text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated ${text.length - MAX_OUTPUT_CHARS} characters]`
    : text

const clampTimeoutMs = (seconds?: number) =>
  Math.min(
    Math.max(Math.ceil(seconds ?? DEFAULT_TIMEOUT_SECONDS), 1),
    MAX_TIMEOUT_SECONDS
  ) * 1000

const OUTSIDE = {
  error: `Paths must be inside ${SANDBOX_ROOT}. Use a relative path or one under ${SANDBOX_ROOT}.`,
}

/**
 * Wraps a tool so that its errors become results the model can read and react
 * to (never exceptions), and so that a session's tool calls run one at a time,
 * in the order the model issued them. Calls in one step otherwise run
 * concurrently, which would let "write the file, then run it" race and two
 * edits to one file overwrite each other.
 */
function guardedIn(queue: { tail: Promise<unknown> }) {
  return <Input, Output>(run: (input: Input) => Promise<Output>) =>
    (input: Input): Promise<Output | { error: string }> => {
      const attempt = async (): Promise<Output | { error: string }> => {
        try {
          return await run(input)
        } catch (error) {
          console.warn("[sandbox] tool failed", error)
          return {
            error: (error instanceof Error
              ? error.message
              : "The sandbox failed"
            ).slice(0, 300),
          }
        }
      }
      const result = queue.tail.then(attempt)
      queue.tail = result
      return result
    }
}

async function run(session: SandboxSession, command: string, seconds?: number) {
  const result = await session.exec(command, {
    timeoutMs: clampTimeoutMs(seconds),
  })
  return {
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    exitCode: result.exitCode,
  }
}

const INTERPRETERS = {
  python: { command: "python3", extension: "py" },
  javascript: { command: "node", extension: "js" },
  bash: { command: "bash", extension: "sh" },
} as const

const timeoutField = z
  .number()
  .positive()
  .optional()
  .describe(
    `Timeout in seconds (default ${DEFAULT_TIMEOUT_SECONDS}, at most ${MAX_TIMEOUT_SECONDS})`
  )

/**
 * The model-facing sandbox tools, ported in interface from LobeHub's
 * `builtin-tool-cloud-sandbox` (a core subset: run code and commands, and
 * read, write, edit and list files). The sandbox is chosen by the server, so
 * none of these can address another user's or topic's sandbox.
 */
export function sandboxTools(session: SandboxSession) {
  const guarded = guardedIn({ tail: Promise.resolve() })
  return {
    runCommand: tool({
      description:
        "Run a shell command in the sandbox (working directory /workspace) and return its stdout, stderr and exit code.",
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .max(10_000)
          .describe("The shell command to run"),
        timeoutSeconds: timeoutField,
      }),
      execute: guarded(async ({ command, timeoutSeconds }) =>
        run(session, command, timeoutSeconds)
      ),
    }),

    executeCode: tool({
      description:
        "Run a snippet of Python, JavaScript (Node) or bash in the sandbox and return its stdout, stderr and exit code. Print what you want to see.",
      inputSchema: z.object({
        language: z.enum(["python", "javascript", "bash"]),
        code: z.string().min(1).max(100_000).describe("The code to run"),
        timeoutSeconds: timeoutField,
      }),
      execute: guarded(async ({ language, code, timeoutSeconds }) => {
        const { command, extension } = INTERPRETERS[language]
        const directory = `${SANDBOX_ROOT}/.run`
        const file = `${directory}/${crypto.randomUUID()}.${extension}`
        await session.exec(`mkdir -p ${shellQuote(directory)}`)
        await session.writeFile(file, code)
        return run(session, `${command} ${shellQuote(file)}`, timeoutSeconds)
      }),
    }),

    writeFile: tool({
      description: `Write a text file in the sandbox, creating parent directories. Paths are relative to ${SANDBOX_ROOT}.`,
      inputSchema: z.object({
        path: z.string().min(1).max(500),
        content: z.string().max(500_000),
      }),
      execute: guarded(async ({ path, content }) => {
        const resolved = resolveSandboxPath(path)
        if (!resolved) return OUTSIDE
        await session.exec(
          `mkdir -p ${shellQuote(resolved.slice(0, resolved.lastIndexOf("/")) || "/")}`
        )
        await session.writeFile(resolved, content)
        return { ok: true, path: resolved, characters: content.length }
      }),
    }),

    readFile: tool({
      description:
        "Read a text file from the sandbox, optionally only a range of lines (1-based, inclusive).",
      inputSchema: z.object({
        path: z.string().min(1).max(500),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      }),
      execute: guarded(async ({ path, startLine, endLine }) => {
        const resolved = resolveSandboxPath(path)
        if (!resolved) return OUTSIDE
        const text = await session.readFile(resolved)
        const ranged =
          startLine || endLine
            ? text
                .split("\n")
                .slice((startLine ?? 1) - 1, endLine)
                .join("\n")
            : text
        return { path: resolved, content: truncate(ranged) }
      }),
    }),

    listFiles: tool({
      description: `List the files and directories in a sandbox directory (default ${SANDBOX_ROOT}).`,
      inputSchema: z.object({ path: z.string().max(500).optional() }),
      execute: guarded(async ({ path }) => {
        const resolved = resolveSandboxPath(path || SANDBOX_ROOT)
        if (!resolved) return OUTSIDE
        const entries = await session.listFiles(resolved)
        return {
          path: resolved,
          entries: entries.slice(0, MAX_LISTED_FILES),
          truncated: entries.length > MAX_LISTED_FILES,
        }
      }),
    }),

    editFile: tool({
      description:
        "Replace text in a sandbox file. `search` must match exactly and be different from `replace`; by default it must occur once.",
      inputSchema: z.object({
        path: z.string().min(1).max(500),
        search: z.string().min(1).max(100_000),
        replace: z.string().max(100_000),
        replaceAll: z.boolean().optional(),
      }),
      execute: guarded(async ({ path, search, replace, replaceAll }) => {
        const resolved = resolveSandboxPath(path)
        if (!resolved) return OUTSIDE
        if (search === replace)
          return { error: "`search` and `replace` are identical" }
        const text = await session.readFile(resolved)
        const occurrences = text.split(search).length - 1
        if (occurrences === 0)
          return { error: "`search` was not found in the file" }
        if (occurrences > 1 && !replaceAll) {
          return {
            error: `\`search\` occurs ${occurrences} times; make it more specific or set replaceAll`,
          }
        }
        await session.writeFile(resolved, text.split(search).join(replace))
        return { ok: true, path: resolved, replaced: occurrences }
      }),
    }),
  }
}

export type SandboxTools = ReturnType<typeof sandboxTools>
