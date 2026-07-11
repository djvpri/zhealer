const axios = require('axios')
const {
  RAILWAY_API_URL, RAILWAY_TOKEN,
  GITHUB_TOKEN, GITHUB_USERNAME,
  MAX_AUTO_FIX_CONFIDENCE
} = require('../config')

// ─── Railway executor ──────────────────────────────────────────────────────

async function railwayMutation(query, variables = {}) {
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

async function redeployService(serviceId, environmentId) {
  const mutation = `
    mutation Redeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(
        serviceId: $serviceId
        environmentId: $environmentId
      )
    }
  `
  return railwayMutation(mutation, { serviceId, environmentId })
}

async function rollbackDeployment(deploymentId) {
  const mutation = `
    mutation Rollback($id: String!) {
      deploymentRollback(id: $id)
    }
  `
  return railwayMutation(mutation, { id: deploymentId })
}

// ─── GitHub executor ───────────────────────────────────────────────────────

async function githubRequest(method, path, data = null) {
  const res = await axios({
    method,
    url: `https://api.github.com${path}`,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    data
  })
  return res.data
}

async function getFileSHA(repo, filePath, branch = 'main') {
  try {
    const data = await githubRequest('GET', `/repos/${GITHUB_USERNAME}/${repo}/contents/${filePath}?ref=${branch}`)
    return data.sha
  } catch {
    return null
  }
}

async function createOrUpdateFile(repo, filePath, content, message, branch) {
  const sha = await getFileSHA(repo, filePath, branch)
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch
  }
  if (sha) body.sha = sha
  return githubRequest('PUT', `/repos/${GITHUB_USERNAME}/${repo}/contents/${filePath}`, body)
}

async function createBranch(repo, branchName, fromBranch = 'main') {
  const ref = await githubRequest('GET', `/repos/${GITHUB_USERNAME}/${repo}/git/ref/heads/${fromBranch}`)
  const sha = ref.object.sha
  return githubRequest('POST', `/repos/${GITHUB_USERNAME}/${repo}/git/refs`, {
    ref: `refs/heads/${branchName}`,
    sha
  })
}

async function createPR(repo, title, body, head, base = 'main') {
  return githubRequest('POST', `/repos/${GITHUB_USERNAME}/${repo}/pulls`, {
    title, body, head, base
  })
}

// ─── Action executor ───────────────────────────────────────────────────────

async function executeAction(action, incident) {
  console.log(`[Executor] Eksekusi action: ${action.type}`)

  switch (action.type) {

    case 'railway_redeploy': {
      const { serviceId, environmentId } = action.payload
      // Prioritas: payload → incident (dari scanner yang sudah capture environmentId)
      const resolvedServiceId = serviceId || incident.serviceId
      const resolvedEnvId = environmentId || incident.environmentId
      if (!resolvedEnvId) {
        return { success: false, message: `environmentId tidak tersedia untuk service ${resolvedServiceId}` }
      }
      await redeployService(resolvedServiceId, resolvedEnvId)
      return { success: true, message: `Redeploy triggered untuk service ${resolvedServiceId}` }
    }

    case 'railway_rollback': {
      const { deploymentId } = action.payload
      await rollbackDeployment(deploymentId || incident.deploymentId)
      return { success: true, message: `Rollback triggered untuk deployment ${deploymentId}` }
    }

    case 'github_create_file':
    case 'github_edit_file': {
      const { repo, filePath, content, commitMessage, branch } = action.payload
      const branchName = branch || `autofix/${incident.errorType}-${Date.now()}`

      try {
        await createBranch(repo, branchName)
      } catch (e) {
        // Branch mungkin sudah ada
      }

      await createOrUpdateFile(repo, filePath, content, commitMessage, branchName)

      const pr = await createPR(
        repo,
        `[AutoFix] ${incident.errorType} di ${incident.appSlug}`,
        `## Auto-fix oleh Zomet Healer\n\n**App:** ${incident.appSlug}\n**Error:** ${incident.errorType}\n\n**Analysis:**\n${incident.analysis || '-'}\n\n**Changes:**\n- ${filePath}\n\n> Review sebelum merge!`,
        branchName
      )

      return { success: true, prUrl: pr.html_url, message: `PR dibuat: ${pr.html_url}` }
    }

    default:
      return { success: false, message: `Action type tidak dikenal: ${action.type}` }
  }
}

// ─── Main fix orchestrator ─────────────────────────────────────────────────

async function executeFix(incident, diagnosis) {
  const results = []

  if (diagnosis.confidence < MAX_AUTO_FIX_CONFIDENCE && diagnosis.fix_type !== 'escalate') {
    console.log(`[Executor] Confidence ${diagnosis.confidence} < ${MAX_AUTO_FIX_CONFIDENCE}, eskalasi`)
    return { escalated: true, reason: 'low_confidence', diagnosis }
  }

  if (diagnosis.fix_type === 'escalate') {
    console.log(`[Executor] Fix type escalate: ${diagnosis.escalation_reason}`)
    return { escalated: true, reason: diagnosis.escalation_reason, diagnosis }
  }

  for (const action of diagnosis.actions || []) {
    try {
      const result = await executeAction(action, { ...incident, analysis: diagnosis.analysis })
      results.push({ action: action.type, ...result })
    } catch (err) {
      console.error(`[Executor] Action ${action.type} gagal:`, err.message)
      results.push({ action: action.type, success: false, error: err.message })
    }
  }

  return { escalated: false, results }
}

module.exports = { executeFix }
