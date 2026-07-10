const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function findPlaybook(errorType, errorRaw) {
  const playbooks = await prisma.playbook.findMany({ where: { errorType } })
  for (const playbook of playbooks) {
    try {
      const regex = new RegExp(playbook.errorPattern, 'i')
      if (regex.test(errorRaw)) return playbook
    } catch {
      if (errorRaw.includes(playbook.errorPattern)) return playbook
    }
  }
  return null
}

async function createIncident(data) {
  return prisma.incident.create({ data })
}

async function updateIncident(id, data) {
  return prisma.incident.update({ where: { id }, data })
}

async function updatePlaybookStats(id, success) {
  const field = success ? 'successCount' : 'failCount'
  return prisma.playbook.update({
    where: { id },
    data: { [field]: { increment: 1 }, lastUsed: new Date() }
  })
}

async function learnFromFix(incident, diagnosis) {
  if (!incident.errorRaw || diagnosis.confidence < 0.9) return
  const pattern = incident.errorType
  try {
    await prisma.playbook.upsert({
      where: { errorPattern: pattern },
      update: { successCount: { increment: 1 }, lastUsed: new Date() },
      create: {
        errorPattern: pattern,
        errorType: incident.errorType,
        fixType: diagnosis.fix_type,
        fixPayload: diagnosis.actions,
        successCount: 1
      }
    })
  } catch {}
}

module.exports = { prisma, findPlaybook, createIncident, updateIncident, updatePlaybookStats, learnFromFix }
