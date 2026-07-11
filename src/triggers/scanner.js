const axios = require('axios')
const { RAILWAY_API_URL, RAILWAY_TOKEN, HEALTH_CHECK_TIMEOUT } = require('../config')
const { getActiveApps, updateAppStatus } = require('../db')

async function railwayQuery(query, variables = {}) {
  const res = await axios.post(
    RAILWAY_API_URL,
    { query, variables },
    { headers: { 'Authorization': `Bearer ${RAILWAY_TOKEN}`, 'Content-Type': 'application/json' } }
  )
  return res.data
}

async function getAllProjects() {
  const query = `query { me { projects { edges { node { id name } } } } }`
  const data = await railwayQuery(query)
  return data?.data?.me?.projects?.edges?.map(e => e.node) || []
}

async function getRecentDeployments(projectId) {
  const query = `
    query GetDeployments($projectId: String!) {
      deployments(input: { projectId: $projectId }) {
        edges { node { id status createdAt environmentId service { id name } } }
      }
    }
  `
  const data = await railwayQuery(query, { projectId })
  return data?.data?.deployments?.edges?.map(e => e.node) || []
}

async function getDeploymentLogs(deploymentId) {
  const query = `
    query GetLogs($deploymentId: String!) {
      deploymentLogs(deploymentId: $deploymentId) { message severity timestamp }
    }
  `
  const data = await railwayQuery(query, { deploymentId })
  return data?.data?.deploymentLogs || []
}

const ERROR_PATTERNS = [
  { pattern: /error: Cannot find module|MODULE_NOT_FOUND/i, type: 'missing_module' },
  { pattern: /PrismaClientKnownRequestError|prisma.*error/i, type: 'prisma_error' },
  { pattern: /lockfile.*mismatch|npm.*lockfile/i, type: 'lockfile_mismatch' },
  { pattern: /nixpacks.*error|build.*failed/i, type: 'build_failure' },
  { pattern: /ECONNREFUSED|database.*connection/i, type: 'db_connection' },
  { pattern: /Enum.*invalid|enum.*value/i, type: 'prisma_enum_mismatch' },
  { pattern: /out of memory|heap.*exhausted/i, type: 'oom' },
]

function detectErrors(logs) {
  const errors = []
  const logText = logs.map(l => l.message).join('\n')
  for (const { pattern, type } of ERROR_PATTERNS) {
    if (pattern.test(logText)) {
      const lines = logText.split('\n')
      const matchLine = lines.findIndex(l => pattern.test(l))
      const snippet = lines.slice(Math.max(0, matchLine - 2), matchLine + 8).join('\n')
      errors.push({ type, snippet })
    }
  }
  return errors
}

async function pingHealthCheck(app) {
  if (!app.healthUrl) return { status: 'skipped', app: app.slug }
  try {
    const res = await axios.get(app.healthUrl, {
      timeout: HEALTH_CHECK_TIMEOUT,
      validateStatus: () => true
    })
    const ok = res.status < 400
    await updateAppStatus(app.slug, ok ? 'healthy' : 'unhealthy')
    if (!ok) {
      return { status: 'unhealthy', app: app.slug, errorType: 'server_error', snippet: `HTTP ${res.status} dari ${app.healthUrl}` }
    }
    return { status: 'healthy', app: app.slug }
  } catch (err) {
    await updateAppStatus(app.slug, 'unreachable')
    return { status: 'unreachable', app: app.slug, errorType: 'unreachable', snippet: `Tidak bisa reach ${app.healthUrl}: ${err.message}` }
  }
}

async function runScan() {
  console.log(`[Scanner] Mulai scan ${new Date().toISOString()}`)
  const incidents = []

  const apps = await getActiveApps()
  console.log(`[Scanner] ${apps.length} apps aktif di database`)

  // Buat set slug/name terdaftar untuk filter Railway projects
  const registeredSlugs = new Set(apps.map(a => a.slug.toLowerCase()))
  const registeredNames = new Set(apps.map(a => a.name.toLowerCase()))

  // 1. Health check semua app
  console.log('[Scanner] Ping health checks...')
  const healthResults = await Promise.allSettled(apps.map(app => pingHealthCheck(app)))

  for (const result of healthResults) {
    if (result.status === 'fulfilled' && result.value.status !== 'healthy' && result.value.status !== 'skipped') {
      incidents.push({
        appSlug: result.value.app,
        errorType: result.value.errorType,
        errorRaw: result.value.snippet,
        source: 'health_check'
      })
    }
  }

  // 2. Scan Railway logs — hanya project yang terdaftar di DB
  console.log('[Scanner] Fetch Railway projects...')
  try {
    const allProjects = await getAllProjects()
    const projects = allProjects.filter(p => {
      const name = p.name.toLowerCase()
      return registeredSlugs.has(name) || registeredNames.has(name) ||
        [...registeredSlugs].some(slug => name.includes(slug) || slug.includes(name))
    })
    console.log(`[Scanner] ${projects.length}/${allProjects.length} project relevan ditemukan`)

    for (const project of projects) {
      try {
        const deployments = await getRecentDeployments(project.id)
        const failed = deployments.filter(d => d.status === 'FAILED' || d.status === 'CRASHED')
        if (failed.length === 0) continue

        console.log(`[Scanner] ${project.name}: ${failed.length} deployment gagal`)
        for (const deployment of failed) {
          const logs = await getDeploymentLogs(deployment.id)
          const errors = detectErrors(logs)
          for (const error of errors) {
            incidents.push({
              appSlug: deployment.service?.name?.toLowerCase() || project.name.toLowerCase(),
              serviceId: deployment.service?.id,
              environmentId: deployment.environmentId,
              deploymentId: deployment.id,
              projectId: project.id,
              errorType: error.type,
              errorRaw: error.snippet,
              source: 'railway_logs'
            })
          }
        }
      } catch (err) {
        console.error(`[Scanner] Gagal scan ${project.name}:`, err.message)
      }
    }
  } catch (err) {
    console.error('[Scanner] Gagal fetch Railway projects:', err.message)
  }

  console.log(`[Scanner] Selesai. ${incidents.length} incident ditemukan.`)
  return incidents
}

module.exports = { runScan, pingHealthCheck }
