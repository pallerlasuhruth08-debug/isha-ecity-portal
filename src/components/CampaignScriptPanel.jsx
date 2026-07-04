import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Per-campaign call script + WhatsApp/SMS message templates (stored on the campaigns
// row: script, whatsapp_template, sms_template). Read-only for callers; coordinators
// get an inline editor (canEdit). Callers always see the coordinator's latest saved
// version because both read the same campaign row.
export default function CampaignScriptPanel({ campaign, canEdit = false, onSaved, onToast }) {
  const [editing, setEditing] = useState(false)
  const [script, setScript] = useState(campaign.script || '')
  const [wa, setWa] = useState(campaign.whatsapp_template || '')
  const [sms, setSms] = useState(campaign.sms_template || '')
  const [busy, setBusy] = useState(false)

  function startEdit() {
    setScript(campaign.script || '')
    setWa(campaign.whatsapp_template || '')
    setSms(campaign.sms_template || '')
    setEditing(true)
  }

  async function save() {
    setBusy(true)
    try {
      const { error } = await supabase
        .from('campaigns')
        .update({ script: script || null, whatsapp_template: wa || null, sms_template: sms || null })
        .eq('id', campaign.id)
      if (error) throw error
      onToast?.('Script & templates updated.')
      setEditing(false)
      onSaved?.()
    } catch (e) {
      onToast?.('Could not save: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const sectionLabel = { fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginBottom: 6 }
  const body = { fontSize: 13, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }
  const empty = { fontSize: 12.5, color: 'var(--muted-2)', fontStyle: 'italic' }

  if (editing) {
    const ta = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, marginTop: 6 }
    return (
      <div className="card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Edit script & templates</h3>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{'placeholders: {name}, {my_name}'}</div>
        </div>
        <label style={{ display: 'block', ...sectionLabel, marginBottom: 0 }}>Call script
          <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={4} style={ta} placeholder="What the caller says…" />
        </label>
        <label style={{ display: 'block', ...sectionLabel, marginTop: 14, marginBottom: 0 }}>WhatsApp template
          <textarea value={wa} onChange={(e) => setWa(e.target.value)} rows={3} style={ta} placeholder="Prefilled into the WhatsApp button…" />
        </label>
        <label style={{ display: 'block', ...sectionLabel, marginTop: 14, marginBottom: 0 }}>SMS template
          <textarea value={sms} onChange={(e) => setSms(e.target.value)} rows={3} style={ta} placeholder="Prefilled into the Message (SMS) button…" />
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Call script & message templates</h3>
        {canEdit && <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={startEdit}>Edit</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 18 }}>
        <div>
          <div style={sectionLabel}>Call script</div>
          {campaign.script ? <div style={body}>{campaign.script}</div> : <div style={empty}>Not set yet.</div>}
        </div>
        <div>
          <div style={sectionLabel}>WhatsApp template</div>
          {campaign.whatsapp_template ? <div style={body}>{campaign.whatsapp_template}</div> : <div style={empty}>Not set yet.</div>}
        </div>
        <div>
          <div style={sectionLabel}>SMS template</div>
          {campaign.sms_template ? <div style={body}>{campaign.sms_template}</div> : <div style={empty}>Not set yet.</div>}
        </div>
      </div>
    </div>
  )
}
