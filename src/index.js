require('dotenv').config()
const cron = require('node-cron')
const express = require('express')
const path = require('path')
const axios = require('axios')
const { runScan } = require('./triggers/scanner')
const { diagnoseIncident } = require('./analyzer/diagnosis')
const { executeFix } = require('./executor/fixer')
const { verifyFix } = require('./validator/verify')
const {
  findPlaybook, createIncident, updateIncident, findOpenIncident, learnFromFix, prisma,
  getActiveApps, addApp, updateApp, deleteApp, syncAppsFromConfig
} = require('./db')
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

    // Skip kalau sudah ada incident terbuka untuk app+errorType yang sama
    const existing = await findOpenIncident(incident.appSlug, incident.errorType)
    if (existing) {
      console.log(`[Healer] Skip — incident #${existing.id} sudah open untuk ${incident.appSlug}/${incident.errorType}`)
      continue
    }

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

      // Tentukan status final
      let finalStatus = 'fixing'
      if (verification.verified === true) {
        finalStatus = 'resolved'
      } else if (fixResult.escalated) {
        finalStatus = 'escalated'
      } else if (verification.verified === 'pending_merge') {
        finalStatus = 'pending_review'
      } else if (fixResult.results?.some(r => r.action === 'railway_redeploy')) {
        finalStatus = 'fixing' // tunggu verifikasi redeploy
      }
      await updateIncident(dbIncident.id, {
        status: finalStatus,
        fixType: diagnosis.fix_type,
        confidence: diagnosis.confidence,
        fixResult: JSON.stringify({ fixResult, verification }),
        prUrl: fixResult.results?.find(r => r.prUrl)?.prUrl || null,
        resolvedAt: finalStatus === 'resolved' ? new Date() : null
      })

      if (finalStatus === 'resolved') {
        await learnFromFix(incident, diagnosis)
        console.log(`[Healer] ✅ ${incident.appSlug} berhasil di-fix!`)
      } else if (finalStatus === 'pending_review') {
        const prUrl = fixResult.results?.find(r => r.prUrl)?.prUrl
        console.log(`[Healer] 👀 ${incident.appSlug} menunggu review PR: ${prUrl}`)
      } else if (finalStatus === 'escalated') {
        console.log(`[Healer] ⚠️ ${incident.appSlug} escalated: ${fixResult.reason}`)
      } else {
        console.log(`[Healer] 🔄 ${incident.appSlug} fixing, menunggu verifikasi...`)
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

// ─── Apps CRUD ─────────────────────────────────────────────────────────────

// List semua app aktif
app.get('/apps', async (req, res) => {
  const apps = await getActiveApps()
  res.json(apps)
})

// Tambah app baru
app.post('/apps', async (req, res) => {
  const { slug, name, healthUrl, githubRepo } = req.body
  if (!slug || !name) return res.status(400).json({ error: 'slug dan name wajib diisi' })
  try {
    const app = await addApp({ slug, name, healthUrl: healthUrl || null, githubRepo: githubRepo || null })
    res.json({ ok: true, app })
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: `App dengan slug "${slug}" sudah ada` })
    res.status(500).json({ error: err.message })
  }
})

// Update app
app.patch('/apps/:slug', async (req, res) => {
  const { name, healthUrl, githubRepo, isActive } = req.body
  try {
    const app = await updateApp(req.params.slug, { name, healthUrl, githubRepo, isActive })
    res.json({ ok: true, app })
  } catch (err) {
    res.status(404).json({ error: `App "${req.params.slug}" tidak ditemukan` })
  }
})

// Nonaktifkan app (soft delete)
app.delete('/apps/:slug', async (req, res) => {
  try {
    await deleteApp(req.params.slug)
    res.json({ ok: true, message: `App "${req.params.slug}" dinonaktifkan` })
  } catch (err) {
    res.status(404).json({ error: `App "${req.params.slug}" tidak ditemukan` })
  }
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

// Export incidents sebagai TXT
app.get('/export', async (req, res) => {
  const incidents = await prisma.incident.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200
  })

  const lines = [
    'ZHEALER INCIDENT REPORT',
    `Generated: ${new Date().toISOString()}`,
    `Total: ${incidents.length} incidents`,
    '='.repeat(60),
    '',
    ...incidents.map((i, idx) => [
      `[${idx + 1}] ${i.appSlug} — ${i.errorType}`,
      `  Status    : ${i.status}`,
      `  Fix Type  : ${i.fixType || '-'}`,
      `  Confidence: ${i.confidence || '-'}`,
      `  PR URL    : ${i.prUrl || '-'}`,
      `  Created   : ${i.createdAt?.toISOString() || '-'}`,
      `  Resolved  : ${i.resolvedAt?.toISOString() || '-'}`,
      `  Error     : ${(i.errorRaw || '').substring(0, 200)}`,
      '',
    ].join('\n'))
  ].join('\n')

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="zhealer-incidents.txt"')
  res.send(lines)
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

app.listen(config.PORT, async () => {
  console.log(`\n🏥 Zomet Healer berjalan di port ${config.PORT}`)
  console.log(`📅 Cron: ${config.CRON_INTERVAL}`)
  console.log(`🔍 Monitoring ${config.ZOMET_APPS.length} apps`)
  console.log(`🌐 Dashboard: http://localhost:${config.PORT}`)
  console.log(`\nEndpoints:`)
  console.log(`  GET    /          — Dashboard UI`)
  console.log(`  POST   /trigger   — Manual trigger scan`)
  console.log(`  GET    /health    — Health check`)
  console.log(`  GET    /status    — Incident list`)
  console.log(`  GET    /apps      — List semua app`)
  console.log(`  POST   /apps      — Tambah app baru`)
  console.log(`  PATCH  /apps/:slug — Update app`)
  console.log(`  DELETE /apps/:slug — Nonaktifkan app\n`)

  // Sync apps dari config ke DB (update githubRepo, healthUrl jika berubah)
  await syncAppsFromConfig(config.ZOMET_APPS)

  setTimeout(() => healLoop().catch(console.error), 5000)
})
