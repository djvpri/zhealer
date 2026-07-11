/**
 * Script: inject-health-endpoints.js
 * 
 * Otomatis tambah file app/api/health/route.ts ke semua repo Zomet
 * yang belum punya endpoint health check.
 * 
 * Jalankan: node scripts/inject-health-endpoints.js
 */

require('dotenv').config({ path: '../.env' })
const axios = require('axios')

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_USERNAME = 'djvpri'

// Daftar repo Next.js Zomet beserta branch utama
const NEXTJS_APPS = [
  { repo: 'zone',       branch: 'main',   prismaPath: '@/lib/prisma' },
  { repo: 'zpos',       branch: 'main',   prismaPath: '@/lib/prisma' },
  { repo: 'zgold',      branch: 'main',   prismaPath: '@/lib/prisma' },
  { repo: 'zresto',     branch: 'main',   prismaPath: '@/lib/prisma' },
  { repo: 'zmedics',    branch: 'main',   prismaPath: '@/lib/prisma' },
  { repo: 'zbengkel',   branch: 'main',   prismaPath: '@/lib/prisma' },
  { repo: 'z-rooms',    branch: 'master', prismaPath: '@/lib/prisma' },
  { repo: 'z-absen',    branch: 'main',   prismaPath: '@/lib/prisma' },
  { repo: 'zgym',       branch: 'main',   prismaPath: '@/lib/prisma' },
  { repo: 'zbarber',    branch: 'main',   prismaPath: '@/lib/prisma' },
  { repo: 'ztransport', branch: 'main',   prismaPath: '@/lib/prisma' },
  { repo: 'zlaundry',   branch: 'main',   prismaPath: '@/lib/prisma' },
]

const HEALTH_CONTENT = (prismaPath) => `import { NextResponse } from 'next/server'
import { prisma } from '${prismaPath}'

export const dynamic = 'force-dynamic'

export async function GET() {
  const start = Date.now()
  try {
    await prisma.$queryRaw\`SELECT 1\`
    return NextResponse.json({
      status: 'ok',
      db: 'connected',
      dbLatencyMs: Date.now() - start,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      db: 'disconnected',
      error: err instanceof Error ? err.message : 'unknown',
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
`

async function githubRequest(method, path, data = null) {
  const res = await axios({
    method,
    url: `https://api.github.com${path}`,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    data,
    validateStatus: () => true
  })
  return { status: res.status, data: res.data }
}

async function fileExists(repo, filePath, branch) {
  const { status } = await githubRequest(
    'GET',
    `/repos/${GITHUB_USERNAME}/${repo}/contents/${filePath}?ref=${branch}`
  )
  return status === 200
}

async function checkRepoExists(repo) {
  const { status } = await githubRequest('GET', `/repos/${GITHUB_USERNAME}/${repo}`)
  return status === 200
}

async function createFile(repo, filePath, content, branch) {
  const { status, data } = await githubRequest(
    'PUT',
    `/repos/${GITHUB_USERNAME}/${repo}/contents/${filePath}`,
    {
      message: 'feat: add /api/health endpoint for ZHealer monitoring',
      content: Buffer.from(content).toString('base64'),
      branch
    }
  )
  return { status, data }
}

async function main() {
  console.log('🏥 ZHealer — Inject Health Endpoints')
  console.log('=====================================\n')

  if (!GITHUB_TOKEN) {
    console.error('❌ GITHUB_TOKEN tidak ada di .env')
    process.exit(1)
  }

  const results = []

  for (const app of NEXTJS_APPS) {
    process.stdout.write(`Cek ${app.repo.padEnd(15)}... `)

    // Cek repo ada
    const repoExists = await checkRepoExists(app.repo)
    if (!repoExists) {
      console.log(`⏭  Repo tidak ditemukan, skip`)
      results.push({ repo: app.repo, status: 'repo_not_found' })
      continue
    }

    // Cek sudah ada health endpoint
    const alreadyExists = await fileExists(
      app.repo,
      'app/api/health/route.ts',
      app.branch
    )

    if (alreadyExists) {
      console.log(`✅ Sudah ada, skip`)
      results.push({ repo: app.repo, status: 'already_exists' })
      continue
    }

    // Inject file
    const content = HEALTH_CONTENT(app.prismaPath)
    const { status } = await createFile(
      app.repo,
      'app/api/health/route.ts',
      content,
      app.branch
    )

    if (status === 201) {
      console.log(`✅ Berhasil ditambahkan`)
      results.push({ repo: app.repo, status: 'injected' })
    } else {
      console.log(`❌ Gagal (HTTP ${status})`)
      results.push({ repo: app.repo, status: 'failed' })
    }

    // Delay kecil supaya tidak hit rate limit
    await new Promise(r => setTimeout(r, 500))
  }

  console.log('\n=====================================')
  console.log('Hasil:')
  const injected = results.filter(r => r.status === 'injected')
  const skipped = results.filter(r => r.status === 'already_exists')
  const failed = results.filter(r => r.status === 'failed')
  const notFound = results.filter(r => r.status === 'repo_not_found')

  console.log(`✅ Ditambahkan : ${injected.length} repo`)
  console.log(`⏭  Sudah ada   : ${skipped.length} repo`)
  console.log(`⏭  Tidak ada   : ${notFound.length} repo`)
  console.log(`❌ Gagal        : ${failed.length} repo`)

  if (injected.length > 0) {
    console.log(`\nRepo yang baru ditambahkan:`)
    injected.forEach(r => console.log(`  - ${r.repo}`))
  }

  if (failed.length > 0) {
    console.log(`\nRepo yang gagal (cek manual):`)
    failed.forEach(r => console.log(`  - ${r.repo}`))
  }

  console.log('\nSelesai! Railway akan auto-deploy setelah commit masuk.')
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
