import type { JSX } from "react"

/**
 * A small inline icon set, drawn by hand (not vendored from any library).
 *
 * Every icon used to be a bare Unicode glyph (▥, ⚙, ◈…). On this Windows
 * build, at least one of them (▥, "Usage") was rendered in full color by the
 * system's emoji font regardless of the text-presentation selector (U+FE0E),
 * which broke the app's monochrome design. SVG with `stroke="currentColor"`
 * sidesteps font-fallback entirely, so it can't recur for any of them.
 */

export type IconName =
  | "plus"
  | "more"
  | "grid"
  | "message"
  | "x"
  | "target"
  | "book"
  | "gem"
  | "search"
  | "image"
  | "bar-chart"
  | "user"
  | "sliders"
  | "log-out"
  | "menu"
  | "arrow-up"
  | "chevron-down"
  | "check"
  | "home"
  | "list-check"
  | "folder"
  | "bell"
  | "panel-left"
  | "sparkles"
  | "file"
  | "graduation"
  | "refresh"
  | "infinity"

const paths: Record<IconName, JSX.Element> = {
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  message: <path d="M4 5h16v11H9l-5 4V5Z" />,
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  book: (
    <>
      <path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" />
      <path d="M8 4v13a3 3 0 0 0 3 3h6" />
    </>
  ),
  gem: <path d="M6 4h12l3 6-9 10L3 10l3-6Z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-5-5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" fill="currentColor" stroke="none" />
      <path d="M21 16l-5.5-5.5a1.5 1.5 0 0 0-2.1 0L4 19" />
    </>
  ),
  "bar-chart": (
    <>
      <path d="M5 20V10" />
      <path d="M12 20V4" />
      <path d="M19 20v-7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9" />
      <path d="M17 7h3" />
      <circle cx="14" cy="7" r="2" fill="currentColor" stroke="none" />
      <path d="M4 17h3" />
      <path d="M11 17h9" />
      <circle cx="8" cy="17" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  "log-out": (
    <>
      <path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9" />
      <path d="M13 12h8" />
      <path d="M17.5 8L21 12l-3.5 4" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),
  "arrow-up": (
    <>
      <path d="M12 19V6" />
      <path d="M6 11l6-6 6 6" />
    </>
  ),
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  home: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v10h13V10" />
      <path d="M9.5 20v-6h5v6" />
    </>
  ),
  "list-check": (
    <>
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="m3.5 6 1.2 1.2L7 4.8" />
      <path d="m3.5 12 1.2 1.2L7 10.8" />
      <path d="m3.5 18 1.2 1.2L7 16.8" />
    </>
  ),
  folder: <path d="M3 6.5h7l2 2h9v10.5H3V6.5Z" />,
  bell: (
    <>
      <path d="M6 17h12l-1.5-2.5V10a4.5 4.5 0 0 0-9 0v4.5L6 17Z" />
      <path d="M10 20h4" />
    </>
  ),
  "panel-left": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="m15 9-3 3 3 3" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3Z" />
      <path d="m18.5 13 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
      <path d="m5 14 1 2.8L9 18l-3 1.2L5 22l-1-2.8L1 18l3-1.2L5 14Z" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </>
  ),
  graduation: (
    <>
      <path d="m3 9 9-5 9 5-9 5-9-5Z" />
      <path d="M7 12v4c2.5 2 7.5 2 10 0v-4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M18.5 16a7 7 0 1 1 .8-7.8L20 12" />
    </>
  ),
  infinity: (
    <path d="M8.5 8.5c-4.5-4.5-7.5 3.5-3 6.5 3 2 5-1 6.5-3 1.5-2 3.5-5 6.5-3 4.5 3 1.5 11-3 6.5" />
  ),
}

/** A monochrome icon that always follows the surrounding text colour. */
export function Icon({
  name,
  size = 16,
  strokeWidth = 1.8,
  className,
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
