const axios = require('axios')
const { RAILWAY_API_URL, RAILWAY_TOKEN, HEALTH_CHECK_TIMEOUT, ZOMET_APPS } = require('../config')

// ─── Railway GraphQL queries ───────────────────────────────────────────────

async function railwayQuery(query, variables = {}) {
  const res = await axios.post(
    RAILWAY_API_URL,
    { query, variables },
    {
      headers: {
        'Authorization': `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  )
  return res.data
}

// Auto-fetch semua project milik akun ini
async function getAllProjects() {
  const query = `
    query {
      me {
        projects {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }
  `
  const data = await railwayQuery(query)
  return data?.data?.me?.projects?.edges?.map(e => e.node) || []
}

// Ambil semua deployments terbaru per project
async function getRecentDeployments(projectId) {
  const query = `
    query GetDeployments($projectId: String!) {
      deployments(input: { projectId: $projectId }) {
        edges {
          node {
            id
            status
            createdAt
            service { id name }
            staticUrl
          }
        }
      }
    }
  `
  const data = await railwayQuery(query, { projectId })
  return data?.data?.deployments?.edges?.map(e => e.node) || []
}

// Ambil logs dari deployment tertentu
async function getDeploymentLogs(deploymentId) {
  const query = `
    query GetLogs($deploymentId: String!) {
      deploymentLogs(deploymentId: $deploymentId) {
        message
        severity
        timestamp
      }
    }
  `
  const data = await railwayQuery(query, { deploymentId })
  return data?.data?.deploymentLogs || []
}

// ─── Error pattern matching ────────────────────────────────────────────────

const ERROR_PATTERNS = [
  {
    pattern: /error: Cannot find module/i,
    type: 'missing_module',
    severity: 'high'
  },
  {
    pattern: /PrismaClientKnownRequestError|prisma.*error/i,
    type: 'prisma_error',
    severity: 'high'
  },
  {
    pattern: /lockfile.*mismatch|npm.*lockfile/i,
    type: 'lockfile_mismatch',
    severity: 'medium'
  },
  {
    pattern: /nixpacks.*error|build.*failed/i,
    type: 'build_failure',
    severity: 'high'
  },
  {
    pattern: /ECONNREFUSED|database.*connection/i,
    type: 'db_connection',
    severity: 'critical'
  },
  {
    pattern: /Enum.*invalid|enum.*value/i,
    type: 'prisma_enum_mismatch',
    severity: 'high'
  },
  {
    pattern: /out of memory|heap.*exhausted/i,
    type: 'oom',
    severity: 'critical'
  },
  {
    pattern: /MODULE_NOT_FOUND/i,
    type: 'missing_module',
    severity: 'high'
  }
]

function detectErrors(logs) {
  const errors = []
  const logText = logs.map(l => l.message).join('\n')

  for (const { pattern, type, severity } of ERROR_PATTERNS) {
    if (pattern.test(logText)) {
      // Ambil 10 baris sekitar error untuk konteks
      const lines = logText.split('\n')
      const matchLine = lines.findIndex(l => pattern.test(l))
      const snippet = lines.slice(Math.max(0, matchLine - 2), matchLine + 8).join('\n')

      errors.push({ type, severity, snippet })
    }
  }

  return errors
}

// ─── Health check pinger ───────────────────────────────────────────────────

async function pingHealthCheck(app) {
  if (!app.healthUrl) return { status: 'skipped', app: app.slug }

  try {
    const res = await axios.get(app.healthUrl, {
      timeout: HEALTH_CHECK_TIMEOUT,
      validateStatus: () => true // jangan throw untuk 4xx/5xx
    })

    if (res.status >= 500) {
      return {
        status: 'unhealthy',
        app: app.slug,
        httpStatus: res.status,
        errorType: 'server_error',
        snippet: `HTTP ${res.status} dari ${app.healthUrl}`
      }
    }

    return { status: 'healthy', app: app.slug }
  } catch (err) {
    return {
      status: 'unreachable',
      app: app.slug,
      errorType: 'unreachable',
      snippet: `Tidak bisa reach ${app.healthUrl}: ${err.message}`
    }
  }
}

// ─── Main scanner ──────────────────────────────────────────────────────────

async function runScan() {
  console.log(`[Scanner] Mulai scan ${new Date().toISOString()}`)
  const incidents = []

  // 1. Health check semua app
  console.log('[Scanner] Ping health checks...')
  const healthResults = await Promise.allSettled(
    ZOMET_APPS.map(app => pingHealthCheck(app))
  )

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

  // 2. Auto-fetch semua Railway project lalu scan logs-nya
  console.log('[Scanner] Fetch semua Railway projects...')
  try {
    const projects = await getAllProjects()
    console.log(`[Scanner] Ditemukan ${projects.length} project: ${projects.map(p => p.name).join(', ')}`)

    for (const project of projects) {
      console.log(`[Scanner] Scan project: ${project.name} (${project.id})`)
      try {
        const deployments = await getRecentDeployments(project.id)
        const failedDeployments = deployments.filter(d =>
          d.status === 'FAILED' || d.status === 'CRASHED'
        )

        if (failedDeployments.length === 0) {
          console.log(`[Scanner] ${project.name}: tidak ada deployment gagal`)
          continue
        }

        console.log(`[Scanner] ${project.name}: ${failedDeployments.length} deployment gagal ditemukan`)

        for (const deployment of failedDeployments) {
          const logs = await getDeploymentLogs(deployment.id)
          const errors = detectErrors(logs)

          for (const error of errors) {
            incidents.push({
              appSlug: deployment.service?.name?.toLowerCase() || project.name.toLowerCase(),
              serviceId: deployment.service?.id,
              deploymentId: deployment.id,
              projectId: project.id,
              projectName: project.name,
              errorType: error.type,
              errorRaw: error.snippet,
              severity: error.severity,
              source: 'railway_logs'
            })
          }
        }
      } catch (err) {
        console.error(`[Scanner] Gagal scan project ${project.name}:`, err.message)
      }
    }
  } catch (err) {
    console.error('[Scanner] Gagal fetch Railway projects:', err.message)
  }

  console.log(`[Scanner] Selesai. Ditemukan ${incidents.length} incident.`)
  return incidents
}

module.exports = { runScan, pingHealthCheck, detectErrors }
