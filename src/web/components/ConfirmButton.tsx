import { useState } from "react"

/** A destructive action that takes a second click to confirm. */
export function ConfirmButton({
  label,
  confirmLabel = "Yes, delete",
  onConfirm,
}: {
  label: string
  confirmLabel?: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)

  return (
    <span className="confirm-group">
      {armed ? (
        <>
          <button
            type="button"
            className="danger-button danger-solid"
            onClick={() => {
              setArmed(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => setArmed(false)}
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className="danger-button"
          onClick={() => setArmed(true)}
        >
          {label}
        </button>
      )}
    </span>
  )
}
