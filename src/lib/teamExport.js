// Team roster export (CSV + PDF) for the Teams tab. Reads the SAME data the
// Teams tab already renders — activity blocks, block_assignments, people,
// block_phases/event_phases (for the execution-period span), and person-in-event
// comments. Nothing here is fabricated; a team/member with no data just shows blank.
import { jsPDF } from 'jspdf'
import { rangeLabel } from './planning'

const ACTIVE_STATUSES = ['assigned', 'show', 'involved']

// One entry per team: { teamName, sizeNeeded, pocName, pocPhone, execPeriod,
// members: [{ name, phone, email, isPoc, comments[] }] } — member ROW COUNT is always
// the team's actual distinct assigned-member count (from block_assignments), never
// sizeNeeded (that's a separate target-headcount field, not a row source).
export function buildTeamRoster({ ev, blocks, assigns, people, blockPhases = {}, eventPhases = [], commentsByPerson = {} }) {
  const phaseById = Object.fromEntries(eventPhases.map((p) => [p.id, p]))
  const eventSpan = rangeLabel(ev.start_date || ev.activity_date, ev.end_date)

  return blocks.map((b) => {
    const active = assigns.filter((a) => a.block_id === b.id && ACTIVE_STATUSES.includes(a.status))
    const byPerson = {}
    for (const a of active) {
      const m = (byPerson[a.person_id] ||= { person_id: a.person_id, poc: false })
      if (a.is_poc) m.poc = true
    }
    const members = Object.values(byPerson)
    const pocs = members.filter((m) => m.poc).map((m) => people[m.person_id]).filter(Boolean)

    const spanIds = blockPhases[b.id] || []
    const spans = spanIds.map((pid) => phaseById[pid]).filter(Boolean)
    const starts = spans.map((p) => p.start_by).filter(Boolean).sort()
    const finishes = spans.map((p) => p.finish_by).filter(Boolean).sort()
    const execPeriod = starts.length ? rangeLabel(starts[0], finishes[finishes.length - 1] || starts[starts.length - 1]) : eventSpan

    return {
      teamName: b.heading,
      sizeNeeded: b.volunteers_needed || 0,
      pocName: pocs.map((p) => p.full_name).join(', '),
      pocPhone: pocs.map((p) => p.phone).filter(Boolean).join(', '),
      execPeriod,
      members: members.map((m) => {
        const p = people[m.person_id] || {}
        return { name: p.full_name || 'Unknown', phone: p.phone || '', email: p.email || '', isPoc: m.poc, comments: commentsByPerson[m.person_id] || [] }
      }),
    }
  })
}

function csvField(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// One row per DISTINCT assigned member (never sizeNeeded). Team-level fields (name,
// size, dates) print only on that team's FIRST row and are left blank on the rest —
// so nothing reads as "one person's name repeated with other members' phone numbers".
// Per-member is_poc replaces a separate POC name/phone column entirely.
export function teamsToCSV(teams) {
  const rows = [['Team Name', 'Size Needed', 'Dates', 'Member Name', 'Phone', 'Email', 'Is POC', 'Comments']]
  for (const t of teams) {
    const teamCols = [t.teamName, t.sizeNeeded, t.execPeriod]
    const blankTeamCols = ['', '', '']
    if (!t.members.length) { rows.push([...teamCols, '', '', '', '', '']); continue }
    t.members.forEach((m, i) => {
      rows.push([...(i === 0 ? teamCols : blankTeamCols), m.name, m.phone, m.email, m.isPoc ? 'yes' : '', m.comments.join(', ')])
    })
  }
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n')
}

// Unassigned volunteers -- SAME column layout as the team roster CSV above, minus
// Email; Team Name/Size Needed/Dates/Is POC are blank since these people have no team.
export function unassignedToCSV(rows) {
  const out = [['Team Name', 'Size Needed', 'Dates', 'Member Name', 'Phone', 'Is POC', 'Comments']]
  for (const r of rows) out.push(['', '', '', r.name, r.phone, '', (r.comments || []).join(', ')])
  return out.map((row) => row.map(csvField).join(',')).join('\r\n')
}

export function downloadCSV(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// One section per team — readable roster (name/phone/email + comment lines), not a table.
export function teamsToPDF(eventName, teams) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const marginX = 40
  const pageH = doc.internal.pageSize.getHeight()
  const pageW = doc.internal.pageSize.getWidth()
  let y = 50

  doc.setFontSize(16); doc.setFont(undefined, 'bold')
  doc.text(eventName, marginX, y); y += 20
  doc.setFontSize(10.5); doc.setFont(undefined, 'normal'); doc.setTextColor(120)
  doc.text('Team roster', marginX, y); y += 22
  doc.setTextColor(20)

  const ensureSpace = (need) => { if (y + need > pageH - 40) { doc.addPage(); y = 50 } }

  for (const t of teams) {
    ensureSpace(64)
    doc.setFontSize(13); doc.setFont(undefined, 'bold')
    doc.text(t.teamName, marginX, y); y += 15
    doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(90)
    doc.text(`POC: ${t.pocName || '—'}${t.pocPhone ? ' (' + t.pocPhone + ')' : ''}`, marginX, y); y += 13
    doc.text(`Execution period: ${t.execPeriod}`, marginX, y); y += 16
    doc.setTextColor(20)

    if (!t.members.length) {
      doc.setFontSize(10); doc.setFont(undefined, 'italic')
      doc.text('No members assigned yet.', marginX + 10, y); y += 16
      doc.setFont(undefined, 'normal')
    }
    for (const m of t.members) {
      ensureSpace(16)
      doc.setFontSize(11); doc.setFont(undefined, 'normal')
      const contact = [m.phone, m.email].filter(Boolean).join('  ·  ')
      doc.text(`•  ${m.name}${contact ? '  —  ' + contact : ''}`, marginX + 10, y); y += 14
      if (m.comments.length) {
        doc.setFontSize(9); doc.setTextColor(110)
        for (const c of m.comments) {
          const lines = doc.splitTextToSize(c, pageW - marginX * 2 - 30)
          for (const line of lines) { ensureSpace(12); doc.text(line, marginX + 26, y); y += 12 }
        }
        doc.setFontSize(11); doc.setTextColor(20)
      }
    }
    y += 12
  }
  return doc
}
