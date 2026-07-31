// RETIRED — the legacy no-login calling portal (#volunteer=<token>).
//
// It granted the full call list, including every recipient's phone number, to
// anyone who opened the link and typed any name + phone: no phone match, no
// coordinator approval. A forwarded link leaked personal contact details.
//
// It is fully superseded by VolunteerPortalClaim (#volunteer-portal/<token>),
// which verifies the volunteer's phone and requires coordinator approval. The
// app no longer generates #volunteer= links anywhere (Campaigns shares the
// claim link), so this route only served old links still circulating.
//
// NOTE: removing this screen stops the app from *offering* the data, but the
// underlying `portal_info` / `portal_list` RPCs are still callable with a token.
// They must be dropped or put behind verification server-side to fully close it.
export default function PublicVolunteerPortal() {
  const box = { maxWidth: 480, margin: '0 auto', width: '100%' }
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...box, textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, fontWeight: 600, color: 'var(--orange)' }}>Electronic City · Volunteer Care</div>
      </div>
      <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>This calling link has been retired</div>
        <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.55 }}>
          We've moved to a new, more secure calling link. Please ask your coordinator
          to send you the current one — your call list and any calls you've already
          logged are safe.
        </div>
      </div>
    </div>
  )
}
