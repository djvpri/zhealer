const axios = require('axios')
const { ZOMET_APPS, HEALTH_CHECK_TIMEOUT } = require('../config')

// Tunggu deployment Railway selesai (polling)
async function waitForDeployment(appSlug, maxWaitMs = 5 * 60 * 1000) {
  const app = ZOMET_APPS.find(a => a.slug === appSlug)
  if (!app?.healthUrl) return { verified: false, reason: 'no_health_url' }

  const startTime = Date.now()
  const pollInterval = 15000 // cek tiap 15 detik

  console.log(`[Validator] Menunggu ${appSlug} sehat kembali...`)

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollInterval))

    try {
      const res = await axios.get(app.healthUrl, {
        timeout: HEALTH_CHECK_TIMEOUT,
        validateStatus: () => true
      })

      if (res.status < 400) {
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        console.log(`[Validator] ${appSlug} sehat setelah ${elapsed}s`)
        return { verified: true, elapsed }
      }

      console.log(`[Validator] ${appSlug} masih HTTP ${res.status}, menunggu...`)
    } catch {
      console.log(`[Validator] ${appSlug} belum bisa direach, menunggu...`)
    }
  }

  return { verified: false, reason: 'timeout' }
}

async function verifyFix(incident, fixResult) {
  // Kalau di-escalate, tidak perlu verify
  if (fixResult.escalated) return { verified: 'escalated' }

  // Kalau ada PR (github_pr fix), tidak ada yang bisa diverify sekarang
  const hasPR = fixResult.results?.some(r => r.prUrl)
  if (hasPR) return { verified: 'pending_merge' }

  // Kalau redeploy, tunggu app sehat
  const hasRedeploy = fixResult.results?.some(r => r.action === 'railway_redeploy')
  if (hasRedeploy) {
    // Tunggu 30 detik dulu baru mulai polling (Railway butuh waktu spin up)
    await new Promise(r => setTimeout(r, 30000))
    return waitForDeployment(incident.appSlug)
  }

  return { verified: 'unknown' }
}

module.exports = { verifyFix, waitForDeployment }
