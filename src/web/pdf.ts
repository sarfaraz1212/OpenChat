/**
 * A small PDF writer for research reports: Helvetica text with bold headings,
 * bullets and page breaks, and no dependency. It handles the Latin script the
 * built-in PDF fonts cover; other characters print as "?".
 */

type Rgb = [number, number, number]
type Line = {
  text: string
  size: number
  bold: boolean
  indent: number
  /** Space above the line. */
  before: number
  color: Rgb
}

const PAGE = { width: 595, height: 842, margin: 56 } // A4 in points
const INK: Rgb = [31, 41, 55]
const HEADING: Rgb = [17, 24, 39]
const ACCENT: Rgb = [31, 58, 95]
const MUTED: Rgb = [107, 114, 128]

/** Helvetica advance widths (per 1000 em) for the printable ASCII range, from its AFM. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
]

function textWidth(text: string, size: number, bold: boolean): number {
  let units = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    units += code >= 32 && code <= 126 ? WIDTHS[code - 32] : 556
  }
  // Bold is a little wider than regular.
  return (units / 1000) * size * (bold ? 1.06 : 1)
}

/** Character codes for the Unicode punctuation that WinAnsi (the PDF font encoding) has. */
const WIN_ANSI: Record<string, number> = {
  "€": 0x80,
  "…": 0x85,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "™": 0x99,
}

/** A string of one-byte characters in WinAnsi, with anything else as "?". */
function toWinAnsi(text: string): string {
  let out = ""
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code >= 32 && code <= 126) out += char
    else if (code >= 0xa0 && code <= 0xff) out += char
    else if (WIN_ANSI[char] !== undefined)
      out += String.fromCharCode(WIN_ANSI[char])
    else out += code === 9 ? " " : "?"
  }
  return out
}

const escapePdf = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")

/** Drop inline markdown, keeping the words (and a link's address after its title). */
function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(
      /\[([^\]]+)]\(([^)\s]+)[^)]*\)/g,
      (_m, title: string, url: string) =>
        title === url ? url : `${title} (${url})`
    )
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string; depth: number }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "blank" }

/** A small markdown tokenizer: headings, lists, quotes, code, tables and paragraphs. */
export function tokenizeMarkdown(markdown: string): Block[] {
  const blocks: Block[] = []
  let inCode = false
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode
      continue
    }
    if (inCode) {
      blocks.push({ kind: "code", text: raw })
      continue
    }
    const line = raw.trim()
    if (!line) {
      blocks.push({ kind: "blank" })
      continue
    }
    if (/^([-*_])\1{2,}$/.test(line)) {
      blocks.push({ kind: "rule" })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: plainInline(heading[2]),
      })
      continue
    }
    // A table's divider row (| --- | --- |) carries no words.
    if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line)) continue
    const bullet = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw)
    if (bullet) {
      blocks.push({
        kind: "bullet",
        text: plainInline(bullet[2]),
        depth: Math.min(2, Math.floor(bullet[1].length / 2)),
      })
      continue
    }
    const text = plainInline(
      line
        .replace(/^>\s?/, "")
        .replace(/^\||\|$/g, "")
        .replace(/\s*\|\s*/g, "  |  ")
    )
    blocks.push({ kind: "paragraph", text })
  }
  return blocks
}

function wrap(
  text: string,
  width: number,
  size: number,
  bold: boolean
): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    // A word longer than a whole line (a long URL) is broken to fit. If the line
    // holds only a list marker, the first piece goes after it, not below it.
    let rest = word
    while (textWidth(rest, size, bold) > width) {
      if (line.length > 2) {
        lines.push(line)
        line = ""
        continue
      }
      const room = line ? width - textWidth(`${line} `, size, bold) : width
      let cut = rest.length
      while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > room) cut--
      const piece = rest.slice(0, cut)
      lines.push(line ? `${line} ${piece}` : piece)
      line = ""
      rest = rest.slice(cut)
    }
    const next = line ? `${line} ${rest}` : rest
    if (line && textWidth(next, size, bold) > width) {
      lines.push(line)
      line = rest
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : [""]
}

function layout(title: string, subtitle: string, markdown: string): Line[] {
  const lines: Line[] = []
  const contentWidth = PAGE.width - PAGE.margin * 2
  const add = (
    text: string,
    size: number,
    options: Partial<Omit<Line, "text" | "size">> = {}
  ) => {
    const indent = options.indent ?? 0
    const parts = wrap(
      toWinAnsi(text),
      contentWidth - indent,
      size,
      !!options.bold
    )
    parts.forEach((part, i) =>
      lines.push({
        text: part,
        size,
        bold: false,
        indent,
        color: INK,
        ...options,
        // Only a block's first line has space above it.
        before: i === 0 ? (options.before ?? 0) : 0,
      })
    )
  }

  add("OpenChat", 11, { bold: true, color: MUTED })
  add(title, 20, { bold: true, color: ACCENT, before: 10 })
  add(subtitle, 9.5, { color: MUTED, before: 4 })
  lines.push({
    text: "",
    size: 9,
    bold: false,
    indent: 0,
    before: 8,
    color: INK,
  })

  for (const block of tokenizeMarkdown(markdown)) {
    switch (block.kind) {
      case "blank":
        break
      case "rule":
        lines.push({
          text: "",
          size: 8,
          bold: false,
          indent: 0,
          before: 4,
          color: INK,
        })
        break
      case "heading": {
        const size = block.level === 1 ? 17 : block.level === 2 ? 14 : 12
        add(block.text, size, {
          bold: true,
          color: HEADING,
          before: size * 0.9,
        })
        break
      }
      case "bullet":
        add(`• ${block.text}`, 10.5, {
          indent: 10 + block.depth * 14,
          before: 3,
        })
        break
      case "code":
        add(block.text, 9.5, { indent: 12, color: MUTED, before: 1 })
        break
      case "paragraph":
        add(block.text, 10.5, { before: 6 })
        break
    }
  }
  return lines
}

/** The report as PDF bytes. */
export function buildReportPdf(params: {
  title: string
  subtitle?: string
  markdown: string
}): Uint8Array<ArrayBuffer> {
  const lines = layout(params.title, params.subtitle ?? "", params.markdown)

  // Place lines on pages, top to bottom.
  const pages: string[][] = [[]]
  let y = PAGE.height - PAGE.margin
  const bottom = PAGE.margin + 18
  for (const line of lines) {
    const height = line.size * 1.38
    if (y - line.before - height < bottom && pages.at(-1)!.length > 0) {
      pages.push([])
      y = PAGE.height - PAGE.margin
    } else {
      y -= line.before
    }
    y -= height
    if (line.text) {
      const [r, g, b] = line.color.map((v) => (v / 255).toFixed(3))
      pages
        .at(-1)!
        .push(
          `BT /${line.bold ? "F2" : "F1"} ${line.size} Tf ${r} ${g} ${b} rg ` +
            `${PAGE.margin + line.indent} ${y.toFixed(2)} Td (${escapePdf(line.text)}) Tj ET`
        )
    }
  }

  // Page numbers, now that the page count is known.
  pages.forEach((commands, i) => {
    const label = `Page ${i + 1} of ${pages.length}`
    const x = PAGE.width - PAGE.margin - textWidth(label, 8.5, false)
    commands.push(
      `BT /F1 8.5 Tf 0.420 0.447 0.502 rg ${x.toFixed(2)} ${PAGE.margin - 8} Td (${label}) Tj ET`
    )
  })

  // Objects: 1 catalog, 2 page tree, 3 and 4 the fonts, then a page and its
  // content for each page.
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ]
  pages.forEach((commands, i) => {
    const content = commands.join("\n")
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    )
  })

  // Every character here is one byte (see toWinAnsi), so string length is
  // byte length and the offsets in the cross-reference table are exact.
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Uint8Array.from(pdf, (char) => char.charCodeAt(0))
}

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "report"

/** Build the report and save it as a PDF download. */
export function downloadReportPdf(params: {
  title: string
  createdAt: string
  markdown: string
}): void {
  const bytes = buildReportPdf({
    title: params.title,
    subtitle: `Created ${new Date(params.createdAt).toLocaleString()}`,
    markdown: params.markdown,
  })
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/pdf" })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = `${slugify(params.title)}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
