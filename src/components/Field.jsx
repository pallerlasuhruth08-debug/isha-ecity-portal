import { useId } from 'react'

// A labelled form field. Every input the public ever sees goes through this.
//
// WHY IT EXISTS
// The two highest-traffic public forms had bare inputs with placeholder-only
// labelling. A placeholder is not a label: it disappears the moment someone
// types, screen readers announce it inconsistently, and "Your phone number"
// greyed out at 15px is the first thing a newcomer to the centre sees. This
// makes the accessible version the easy version, so no future form has to
// remember.
//
// - real <label for> tied to the input by a generated id
// - required is stated in words, not just a red asterisk
// - hint text is linked via aria-describedby, so it is read out, not just seen
// - errors use aria-invalid + role="alert", so they are announced when they appear
// - 44px minimum height: a thumb target, not a mouse target
export default function Field({
  label, required, hint, error, children, id: idProp, ...inputProps
}) {
  const auto = useId()
  const id = idProp || auto
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="field-required"> (required)</span>}
      </label>
      {hint && <div className="field-hint" id={hintId}>{hint}</div>}
      {children
        ? children({ id, describedBy, invalid: !!error })
        : (
          <input
            id={id}
            className="field-input"
            aria-describedby={describedBy}
            aria-invalid={error ? 'true' : undefined}
            aria-required={required ? 'true' : undefined}
            {...inputProps}
          />
        )}
      {error && <div className="field-error" id={errId} role="alert">{error}</div>}
    </div>
  )
}

// The shell every no-login page sits in, so the brand line, spacing and card
// treatment are identical across interest, accept, claim and attendance instead
// of being re-typed four slightly different ways.
export function PublicShell({ children }) {
  return (
    <div className="public-shell">
      <div className="public-brand">Isha Electronic City · Volunteer Care</div>
      {children}
    </div>
  )
}

// A finished public flow should never be a dead end. Every confirmation says
// what just happened AND what happens next, because "Thank you" alone leaves a
// newcomer wondering whether anything actually reached anyone.
export function PublicDone({ title, children, next }) {
  return (
    <div className="card public-card public-done">
      <div className="public-done-mark" aria-hidden="true">🙏</div>
      <div className="public-done-title">{title}</div>
      {children && <div className="public-done-body">{children}</div>}
      {next && (
        <div className="public-next">
          <div className="public-next-label">What happens next</div>
          <div className="public-next-body">{next}</div>
        </div>
      )}
    </div>
  )
}
