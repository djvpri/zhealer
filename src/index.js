require('dotenv').config()
const cron = require('node-cron')
const express = require('express')
const { runScan } = require('./triggers/scanner')
const { diagnoseIncident } = require('./analyzer/diagnosis')
const { executeFix, notifyWA } = require('./executor/fixer')
const { verifyFix } = require('./validator/verify')
const { findPlaybook, createIncident, updateIncident, learnFromFix } = require('./db')
const config = require('./config')

const app = express()
app.use(express.json())

// ─── Core heal loop ────────────────────────────────────────────────────────

async function healLoop() {
  console.log('\n========================================')
  console.log('[Healer] Mulai heal loop...')

  let incidents = []

  try {
    incidents = await runScan(config.RAILWAY_PROJECT_ID)
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
      // Simpan incident ke DB
      dbIncident = await createIncident({
        appSlug: incident.appSlug,
        serviceId: incident.serviceId || '',
        errorType: incident.errorType,
        errorRaw: incident.errorRaw,
        status: 'open'
      })

      // Cek playbook dulu
      const playbook = await findPlaybook(incident.errorType, incident.errorRaw)

      // Diagnosa
      const diagnosis = await diagnoseIncident(incident, playbook)
      console.log(`[Healer] Diagnosis: ${diagnosis.fix_type} (confidence: ${diagnosis.confidence})`)

      await updateIncident(dbIncident.id, {
        status: 'fixing',
        fixType: diagnosis.fix_type,
        confidence: diagnosis.confidence
      })

      // Eksekusi fix
      const fixResult = await executeFix(incident, diagnosis)

      // Verifikasi
      const verification = await verifyFix(incident, fixResult)
      console.log(`[Healer] Verifikasi: ${JSON.stringify(verification)}`)

      // Update status final
      const resolved = verification.verified === true
      await updateIncident(dbIncident.id, {
        status: resolved ? 'resolved' : fixResult.escalated ? 'escalated' : 'fixing',
        fixResult: JSON.stringify({ fixResult, verification }),
        prUrl: fixResult.results?.find(r => r.prUrl)?.prUrl || null,
        resolvedAt: resolved ? new Date() : null
      })

      // Belajar dari fix yang berhasil
      if (resolved) {
        await learnFromFix(incident, diagnosis)
        console.log(`[Healer] ✅ ${incident.appSlug} berhasil di-fix dan verified!`)
      } else if (fixResult.escalated) {
        console.log(`[Healer] ⚠️ ${incident.appSlug} di-eskalasi ke WA`)
      }

    } catch (err) {
      console.error(`[Healer] Error proses incident ${incident.appSlug}:`, err.message)
      if (dbIncident) {
        await updateIncident(dbIncident.id, {
          status: 'escalated',
          fixResult: `Internal error: ${err.message}`
        }).catch(() => {})
      }
      // Notif WA kalau ada error tak terduga
      await notifyWA(
        `🚨 *Zomet Healer Error*\n\nGagal proses incident di *${incident.appSlug}*\n\nError: ${err.message}`
      ).catch(() => {})
    }
  }

  console.log('\n[Healer] Heal loop selesai.')
}

// ─── HTTP endpoints ────────────────────────────────────────────────────────

// Manual trigger (bisa dipanggil dari Z-Dashboard atau webhook Railway)
app.post('/trigger', async (req, res) => {
  console.log('[API] Manual trigger diterima')
  res.json({ ok: true, message: 'Heal loop dimulai' })
  healLoop().catch(console.error)
})

// Health check endpoint sendiri
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Status: incident terbaru
app.get('/status', async (req, res) => {
  const { prisma } = require('./db')
  const incidents = await prisma.incident.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20
  })
  res.json(incidents)
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
  console.log(`🤖 LLM: ${config.LLM_BASE_URL} / ${config.LLM_MODEL}`)
  console.log('\nEndpoints:')
  console.log('  POST /trigger  — manual trigger')
  console.log('  GET  /health   — health check')
  console.log('  GET  /status   — incident terbaru\n')

  // Jalankan sekali saat start
  setTimeout(() => healLoop().catch(console.error), 5000)
})
