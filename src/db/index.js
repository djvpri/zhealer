const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// ─── Playbook ──────────────────────────────────────────────────────────────

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

// ─── Incident ─────────────────────────────────────────────────────────────

async function createIncident(data) {
  return prisma.incident.create({ data })
}

async function updateIncident(id, data) {
  return prisma.incident.update({ where: { id }, data })
}

async function learnFromFix(incident, diagnosis) {
  if (!incident.errorRaw || diagnosis.confidence < 0.9) return
  try {
    await prisma.playbook.upsert({
      where: { errorPattern: incident.errorType },
      update: { successCount: { increment: 1 }, lastUsed: new Date() },
      create: {
        errorPattern: incident.errorType,
        errorType: incident.errorType,
        fixType: diagnosis.fix_type,
        fixPayload: diagnosis.actions,
        successCount: 1
      }
    })
  } catch {}
}

// ─── ZometApp — DB sebagai source of truth ────────────────────────────────

async function getActiveApps() {
  return prisma.zometApp.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' }
  })
}

async function addApp(data) {
  return prisma.zometApp.create({ data })
}

async function updateApp(slug, data) {
  return prisma.zometApp.update({ where: { slug }, data })
}

async function deleteApp(slug) {
  return prisma.zometApp.update({
    where: { slug },
    data: { isActive: false }
  })
}

async function updateAppStatus(slug, status) {
  return prisma.zometApp.update({
    where: { slug },
    data: { lastStatus: status, lastChecked: new Date() }
  }).catch(() => {}) // skip kalau app tidak ada di DB
}

// Seed apps dari config ke DB kalau DB masih kosong
async function seedAppsIfEmpty(apps) {
  const count = await prisma.zometApp.count()
  if (count > 0) return

  console.log('[DB] Seeding apps dari config...')
  for (const app of apps) {
    await prisma.zometApp.upsert({
      where: { slug: app.slug },
      update: {},
      create: {
        slug: app.slug,
        name: app.name,
        healthUrl: app.healthUrl || null,
        githubRepo: app.githubRepo || null,
        isActive: true
      }
    })
  }
  console.log(`[DB] ${apps.length} apps di-seed ke database`)
}

module.exports = {
  prisma,
  findPlaybook, createIncident, updateIncident, learnFromFix,
  getActiveApps, addApp, updateApp, deleteApp, updateAppStatus, seedAppsIfEmpty
}
