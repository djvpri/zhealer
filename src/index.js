require('dotenv').config()
const cron = require('node-cron')
const express = require('express')
const path = require('path')
const axios = require('axios')
const { runScan } = require('./triggers/scanner')
const { diagnoseIncident } = require('./analyzer/diagnosis')
const { executeFix } = require('./executor/fixer')
const { verifyFix } = require('./validator/verify')
const { findPlaybook, createIncident, updateIncident, learnFromFix, prisma } = require('./db')
const config = require('./config')

const app = express()
app.use(express.json())

// ─── Core heal loop ────────────────────────────────────────────────────────

async function healLoop() {
  console.log('\n========================================')
  console.log('[Healer] Mulai heal loop...')

  let incidents = []

  try {
    incidents = await runScan()
  } catch (err) {
    console.error('[Healer] Scanner error:', err.message)
    return
  }

  if (incidents.length === 0) {
    console.log('[Healer] Semua app sehat. Tidak ada incident.')
    return
  }

  console.log(`[Healer] ${incidents.length} incident ditemukan. Proses satu per satu...`)

  for (const incident of incidents) {
    console.log(`\n--- Proses: ${incident.appSlug} / ${incident.errorType} ---`)

    let dbIncident
    try {
      dbIncident = await createIncident({
        appSlug: incident.appSlug,
        serviceId: incident.serviceId || '',
        errorType: incident.errorType,
        errorRaw: incident.errorRaw,
        status: 'open'
      })

      const playbook = await findPlaybook(incident.errorType, incident.errorRaw)
      const diagnosis = await diagnoseIncident(incident, playbook)
      console.log(`[Healer] Diagnosis: ${diagnosis.fix_type} (confidence: ${diagnosis.confidence})`)

      await updateIncident(dbIncident.id, {
        status: 'fixing',
        fixType: diagnosis.fix_type,
        confidence: diagnosis.confidence
      })

      const fixResult = await executeFix(incident, diagnosis)
      const verification = await verifyFix(incident, fixResult)
      console.log(`[Healer] Verifikasi: ${JSON.stringify(verification)}`)

      const resolved = verification.verified === true
      await updateIncident(dbIncident.id, {
        status: resolved ? 'resolved' : fixResult.escalated ? 'escalated' : 'fixing',
        fixResult: JSON.stringify({ fixResult, verification }),
        prUrl: fixResult.results?.find(r => r.prUrl)?.prUrl || null,
        resolvedAt: resolved ? new Date() : null
      })

      if (resolved) {
        await learnFromFix(incident, diagnosis)
        console.log(`[Healer] ✅ ${incident.appSlug} berhasil di-fix!`)
      } else if (fixResult.escalated) {
        console.log(`[Healer] ⚠️ ${incident.appSlug} escalated: ${fixResult.reason}`)
      }

    } catch (err) {
      console.error(`[Healer] Error proses incident ${incident.appSlug}:`, err.message)
      if (dbIncident) {
        await updateIncident(dbIncident.id, {
          status: 'escalated',
          fixResult: `Internal error: ${err.message}`
        }).catch(() => {})
      }
    }
  }

  console.log('\n[Healer] Heal loop selesai.')
}

// ─── HTTP endpoints ────────────────────────────────────────────────────────

// Dashboard UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'))
})

// Proxy health check (hindari CORS issue dari browser)
app.get('/proxy-health', async (req, res) => {
  const { url } = req.query
  if (!url) return res.json({ ok: false, error: 'no url' })
  try {
    const result = await axios.get(url, { timeout: 8000, validateStatus: () => true })
    res.json({ ok: result.status < 400, status: result.status, data: result.data })
  } catch (err) {
    res.json({ ok: false, error: err.message })
  }
})

// Manual trigger
app.post('/trigger', async (req, res) => {
  console.log('[API] Manual trigger diterima')
  res.json({ ok: true, message: 'Heal loop dimulai' })
  healLoop().catch(console.error)
})

// Health check zhealer sendiri
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Incident list dengan filter opsional
app.get('/status', async (req, res) => {
  const { status } = req.query
  const where = status ? { status } : {}
  const incidents = await prisma.incident.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50
  })
  res.json(incidents)
})

// Stats summary
app.get('/stats', async (req, res) => {
  const [total, resolved, escalated, open] = await Promise.all([
    prisma.incident.count(),
    prisma.incident.count({ where: { status: 'resolved' } }),
    prisma.incident.count({ where: { status: 'escalated' } }),
    prisma.incident.count({ where: { status: { in: ['open', 'fixing'] } } }),
  ])
  res.json({ total, resolved, escalated, open })
})

// ─── Cron job ──────────────────────────────────────────────────────────────

cron.schedule(config.CRON_INTERVAL, () => {
  healLoop().catch(err => {
    console.error('[Cron] Heal loop error:', err.message)
  })
})

// ─── Start server ──────────────────────────────────────────────────────────

app.listen(config.PORT, () => {
  console.log(`\n🏥 Zomet Healer berjalan di port ${config.PORT}`)
  console.log(`📅 Cron: ${config.CRON_INTERVAL}`)
  console.log(`🔍 Monitoring ${config.ZOMET_APPS.length} apps`)
  console.log(`🌐 Dashboard: http://localhost:${config.PORT}`)
  console.log(`\nEndpoints:`)
  console.log(`  GET  /          — Dashboard UI`)
  console.log(`  POST /trigger   — Manual trigger scan`)
  console.log(`  GET  /health    — Health check`)
  console.log(`  GET  /status    — Incident list`)
  console.log(`  GET  /stats     — Stats summary\n`)

  setTimeout(() => healLoop().catch(console.error), 5000)
})
