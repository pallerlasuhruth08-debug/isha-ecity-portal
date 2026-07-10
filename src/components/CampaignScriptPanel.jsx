import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fillTemplate } from '../lib/phone'

const PREVIEW_SAMPLE = { name: 'Priya Kumar', myName: 'Coordinator' }

// Per-campaign call script + WhatsApp/SMS message templates (stored on the campaigns
// row: script, whatsapp_template, sms_template). Read-only for callers; coordinators
// get an inline editor (canEdit). Callers always see the coordinator's latest saved
// version because both read the same campaign row.
export default function CampaignScriptPanel({ campaign, canEdit = false, onSaved, onToast, hideScript = false }) {
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
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>Edit script & templates</h3>
        <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ink-soft)', background: 'var(--panel)', border: '1px solid var(--border-soft)', borderRadius: 9, padding: '10px 12px', marginBottom: 14 }}>
          <strong>Available variables:</strong><br />
          <code>{'{{name}}'}</code> — recipient's first name &nbsp;·&nbsp; <code>{'{{full_name}}'}</code> — recipient's full name<br />
          <span style={{ color: 'var(--muted-2)' }}>Example: "Namaskaram {'{{name}}'}, we would love to have you join us for…"</span>
        </div>
        {!hideScript && (
          <label style={{ display: 'block', ...sectionLabel, marginBottom: 0 }}>Call script
            <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={4} style={ta} placeholder="What the caller says…" />
          </label>
        )}
        <label style={{ display: 'block', ...sectionLabel, marginTop: hideScript ? 0 : 14, marginBottom: 0 }}>WhatsApp template
          <textarea value={wa} onChange={(e) => setWa(e.target.value)} rows={3} style={ta} placeholder="Prefilled into the WhatsApp button…" />
        </label>
        {wa.trim() && <TemplatePreview text={fillTemplate(wa, PREVIEW_SAMPLE)} />}
        <label style={{ display: 'block', ...sectionLabel, marginTop: 14, marginBottom: 0 }}>SMS template
          <textarea value={sms} onChange={(e) => setSms(e.target.value)} rows={3} style={ta} placeholder="Prefilled into the Message (SMS) button…" />
        </label>
        {sms.trim() && <TemplatePreview text={fillTemplate(sms, PREVIEW_SAMPLE)} />}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 18 }}>
      {/* No heading here — the tab this lives under is already labelled "Script & Templates". */}
      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={startEdit}>Edit</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 18 }}>
        {!hideScript && (
          <div>
            <div style={sectionLabel}>Call script</div>
            {campaign.script ? <div style={body}>{campaign.script}</div> : <div style={empty}>Not set yet.</div>}
          </div>
        )}
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

// Live preview with a sample recipient name -- updates as the coordinator types,
// so they can see {{name}}/{{full_name}} resolve without sending a test message.
function TemplatePreview({ text }) {
  return (
    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', background: '#FBF6EC', border: '1px dashed var(--border)', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
      <span style={{ fontWeight: 700, color: 'var(--muted-2)', textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '.05em' }}>Preview</span>{'\n'}{text}
    </div>
  )
}
