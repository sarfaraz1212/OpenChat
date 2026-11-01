/** 1 MB: an upload is chunked, embedded and indexed inside one request. */
export const MAX_FILE_BYTES = 1_048_576

const TEXT_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
])

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "log",
  "ini",
  "toml",
  "rst",
  "tex",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "cs",
  "php",
  "sql",
  "sh",
  "css",
])

/** Browsers label many text files with no type or a generic binary one. */
const GENERIC_TYPES = new Set(["", "application/octet-stream"])

function mimeOf(type: string): string {
  return type.split(";")[0].trim().toLowerCase()
}

export function isSupportedTextFile(name: string, type: string): boolean {
  const mime = mimeOf(type)
  if (mime.startsWith("text/") || TEXT_TYPES.has(mime)) return true
  if (!GENERIC_TYPES.has(mime)) return false
  const extension = name.split(".").pop()?.toLowerCase() ?? ""
  return TEXT_EXTENSIONS.has(extension)
}

/** The type to store: what the browser said, or plain text for generic labels. */
export function storedFileType(type: string): string {
  const mime = mimeOf(type)
  return GENERIC_TYPES.has(mime) ? "text/plain" : mime
}

/** Decode a text file; `null` if it turns out to be binary. */
export function decodeText(bytes: Uint8Array): string | null {
  const text = new TextDecoder("utf-8").decode(bytes)
  return text.includes("\u0000") ? null : text
}
