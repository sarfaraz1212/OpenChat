import { NavLink } from "react-router"

const TABS = [
  { to: "/images", label: "Generate" },
  { to: "/background-removal", label: "Remove background" },
  { to: "/image-enhancer", label: "Enhance" },
]

/** Switches between the image pages, which share one sidebar entry. */
export function ImageTabs() {
  return (
    <nav className="tabs" aria-label="Image tools">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) => (isActive ? "active" : undefined)}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
