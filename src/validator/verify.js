const axios = require('axios')
const { HEALTH_CHECK_TIMEOUT } = require('../config')
const { getActiveApps } = require('../db')

async function waitForDeployment(appSlug, maxWaitMs = 5 * 60 * 1000) {
  // Cari healthUrl dari DB, bukan dari config hardcoded
  const apps = await getActiveApps()
  const app = apps.find(a => a.slug === appSlug)
  if (!app?.healthUrl) return { verified: false, reason: 'no_health_url' }

  const startTime = Date.now()
  const pollInterval = 15000

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
  if (fixResult.escalated) return { verified: 'escalated' }

  const hasPR = fixResult.results?.some(r => r.prUrl)
  if (hasPR) return { verified: 'pending_merge' }

  const hasRedeploy = fixResult.results?.some(r => r.action === 'railway_redeploy')
  if (hasRedeploy) {
    await new Promise(r => setTimeout(r, 30000))
    return waitForDeployment(incident.appSlug)
  }

  return { verified: 'unknown' }
}

module.exports = { verifyFix, waitForDeployment }
