import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Unified campaign editor: name, script, WhatsApp/SMS templates, distribution mode and
// schedule in one place (callers + recipients + event link have their own dedicated
// controls on the detail page). Every save stamps edited_by / edited_at for audit.
// Distribution mode change affects only FUTURE added recipients — it never reshuffles
// existing caller assignments (that would move live work mid-campaign).
const DIST = [
  { key: 'equal', label: 'Divide equally' },
  { key: 'shared', label: 'Shared pool' },
  { key: 'manual', label: 'Manual' },
  { key: 'single', label: 'Single caller' },
  { key: 'none', label: 'No callers' },
]

export default function EditCampaignDialog({ campaign, me, onClose, onSaved, onToast }) {
  const [name, setName] = useState(campaign.name || '')
  const [campaignType, setCampaignType] = useState(campaign.campaign_type || 'full')
  const [script, setScript] = useState(campaign.script || '')
  const [wa, setWa] = useState(campaign.whatsapp_template || '')
  const [sms, setSms] = useState(campaign.sms_template || '')
  const [dist, setDist] = useState(campaign.segment?.distribution || 'none')
  const [schedule, setSchedule] = useState(campaign.segment?.schedule || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function save() {
    if (!name.trim()) return setErr('Give the campaign a name.')
    setBusy(true)
    setErr(null)
    try {
      const seg = { ...(campaign.segment || {}), distribution: dist, schedule: schedule || null }
      const { error } = await supabase.from('campaigns').update({
        name: name.trim(),
        campaign_type: campaignType,
        script: campaignType === 'messaging' ? null : (script.trim() || null),
        whatsapp_template: wa.trim() || null,
        sms_template: sms.trim() || null,
        segment: seg,
        edited_by: me?.id || null,
        edited_at: new Date().toISOString(),
      }).eq('id', campaign.id)
      if (error) throw error
      onToast?.(`Campaign “${name.trim()}” updated.`)
      onSaved?.()
      onClose?.()
    } catch (e) {
      setErr(e.message || String(e))
    } finally { setBusy(false) }
  }

  const field = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13.5, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }
  const label = { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 6, display: 'block' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 125, padding: 20 }} onClick={onClose}>
      <div className="card modal-sheet" style={{ width: 560, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 26, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px' }}>Edit campaign</h2>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 18 }}>Callers, recipients and the event link are edited from the detail page.</div>
        {err && <div style={{ background: '#FBE6E0', color: '#B5532F', padding: '10px 12px', borderRadius: 9, fontSize: 12.5, marginBottom: 14 }}>{err}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={label}>Campaign type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ v: 'full', l: 'Full Campaign' }, { v: 'messaging', l: 'Messaging Campaign' }].map((t) => (
                <button key={t.v} type="button" onClick={() => setCampaignType(t.v)} className="btn" style={{ flex: 1, padding: '9px 12px', fontSize: 12.5, background: campaignType === t.v ? '#241B14' : '#fff', color: campaignType === t.v ? '#F6ECDC' : 'var(--ink-soft)', border: campaignType === t.v ? 'none' : '1px solid var(--border)' }}>{t.l}</button>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>{campaignType === 'messaging' ? 'WhatsApp & SMS only — no call script or dialing.' : 'Calls + WhatsApp + SMS, with a call script.'}</div>
          </div>
          <div>
            <label style={label}>Campaign name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={field} />
          </div>
          {campaignType === 'full' && (
            <div>
              <label style={label}>Call script</label>
              <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={2} style={{ ...field, resize: 'vertical' }} placeholder="One step per line…" />
            </div>
          )}
          <div style={campaignType === 'messaging' ? { padding: 12, border: '1px solid #E7C9B8', borderRadius: 10, background: '#FBF6EC', display: 'flex', flexDirection: 'column', gap: 12 } : { display: 'flex', flexDirection: 'column', gap: 12 }}>
            {campaignType === 'messaging' && <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#9C4A14' }}>Message content</div>}
            <div>
              <label style={label}>WhatsApp template</label>
              <textarea value={wa} onChange={(e) => setWa(e.target.value)} rows={2} style={{ ...field, resize: 'vertical' }} placeholder="Prefilled into the WhatsApp button…" />
            </div>
            <div>
              <label style={label}>SMS template</label>
              <textarea value={sms} onChange={(e) => setSms(e.target.value)} rows={2} style={{ ...field, resize: 'vertical' }} placeholder="Prefilled into the SMS button…" />
            </div>
          </div>
          <div>
            <label style={label}>Distribution (applies to newly added recipients)</label>
            <select value={dist} onChange={(e) => setDist(e.target.value)} style={field}>
              {DIST.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Schedule (optional)</label>
            <input type="date" value={schedule || ''} onChange={(e) => setSchedule(e.target.value)} style={field} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}
