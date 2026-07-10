const axios = require('axios')
const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = require('../config')

const SYSTEM_PROMPT = `Kamu adalah Zomet Auto-Healer, AI agent yang mendiagnosa dan memperbaiki error pada ekosistem aplikasi SaaS Indonesia bernama Zomet.

Stack teknologi Zomet:
- Next.js 14/16 dengan App Router
- PostgreSQL + Prisma ORM
- NextAuth untuk autentikasi  
- Deployed di Railway
- Bahasa: TypeScript/JavaScript

Apps: Z One (SSO), ZPos, ZGold, ZResto, ZMedics, ZBengkel, Z-Rooms, ZFace, ZGym, ZBarber, ZTransport, ZLaundry

PENTING: Response kamu HARUS selalu berupa JSON valid tanpa markdown, tanpa backtick, tanpa teks tambahan apapun.

Format response:
{
  "analysis": "penjelasan singkat root cause",
  "confidence": 0.0-1.0,
  "fix_type": "redeploy" | "github_pr" | "env_check" | "escalate" | "ignore",
  "actions": [
    {
      "type": "github_create_file" | "github_edit_file" | "railway_redeploy" | "railway_restart" | "notify_wa",
      "description": "apa yang dilakukan",
      "payload": {}
    }
  ],
  "escalation_reason": "alasan kalau fix_type = escalate",
  "estimated_fix_time": "< 5 menit" | "5-15 menit" | "> 15 menit"
}

Aturan fix_type:
- "redeploy": kalau cukup trigger redeploy Railway (lockfile issue, env var berubah, dll)
- "github_pr": kalau butuh perubahan kode/config (nixpacks.toml missing, package.json fix, dll)  
- "env_check": kalau kemungkinan env var hilang/salah
- "escalate": kalau menyangkut database migration, perubahan schema, atau logic bisnis
- "ignore": kalau false positive / tidak kritis`

async function callLLM(messages) {
  // Support OpenAI-compatible format (untuk 9router) dan Anthropic format
  const isAnthropic = LLM_BASE_URL.includes('anthropic.com')

  if (isAnthropic) {
    // Anthropic native format
    const res = await axios.post(
      `${LLM_BASE_URL}/v1/messages`,
      {
        model: LLM_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages
      },
      {
        headers: {
          'x-api-key': LLM_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      }
    )
    return res.data.content?.[0]?.text || ''
  } else {
    // OpenAI-compatible format (9router)
    const res = await axios.post(
      `${LLM_BASE_URL}/v1/chat/completions`,
      {
        model: LLM_MODEL,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${LLM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    )
    return res.data.choices?.[0]?.message?.content || ''
  }
}

function parseJSON(text) {
  try {
    // Strip markdown fences kalau ada
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return null
  }
}

async function diagnoseIncident(incident, playbookMatch = null) {
  // Kalau ada playbook match dengan high success rate, pakai langsung
  if (playbookMatch && playbookMatch.successCount >= 3 && playbookMatch.failCount === 0) {
    console.log(`[Analyzer] Pakai playbook untuk ${incident.errorType}`)
    return {
      fromPlaybook: true,
      playbookId: playbookMatch.id,
      analysis: `Match playbook: ${playbookMatch.errorPattern}`,
      confidence: 0.95,
      fix_type: playbookMatch.fixType,
      actions: playbookMatch.fixPayload,
      estimated_fix_time: '< 5 menit'
    }
  }

  console.log(`[Analyzer] LLM diagnosis untuk ${incident.appSlug} - ${incident.errorType}`)

  const userMessage = `
App: ${incident.appSlug}
Error type: ${incident.errorType}
Source: ${incident.source}
${incident.serviceId ? `Railway Service ID: ${incident.serviceId}` : ''}
${incident.deploymentId ? `Deployment ID: ${incident.deploymentId}` : ''}

Log snippet:
${incident.errorRaw}

Diagnosa error ini dan berikan rencana fix dalam format JSON yang sudah ditentukan.
`

  try {
    const response = await callLLM([{ role: 'user', content: userMessage }])
    const parsed = parseJSON(response)

    if (!parsed) {
      console.error('[Analyzer] Gagal parse JSON dari LLM:', response.substring(0, 200))
      return {
        analysis: 'Gagal parse response LLM',
        confidence: 0,
        fix_type: 'escalate',
        escalation_reason: 'LLM response tidak valid',
        actions: []
      }
    }

    return parsed
  } catch (err) {
    console.error('[Analyzer] LLM error:', err.message)
    return {
      analysis: 'LLM tidak bisa dihubungi',
      confidence: 0,
      fix_type: 'escalate',
      escalation_reason: `LLM error: ${err.message}`,
      actions: []
    }
  }
}

module.exports = { diagnoseIncident }
