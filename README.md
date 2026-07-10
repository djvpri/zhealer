# 🏥 Zomet Healer

Self-healing agent untuk ekosistem Zomet. Otomatis deteksi, diagnosa, dan perbaiki error di 25+ Railway apps tanpa intervensi manual.

## Cara kerja

```
Cron tiap 30 menit
    ↓
Scanner: ping health check + scan Railway logs
    ↓
Analyzer: diagnosa via LLM (9router/Anthropic) → JSON structured output
    ↓
Executor (berdasarkan confidence & fix_type):
    ├── confidence ≥ 85% + fix aman → AUTO FIX
    │       ├── redeploy → Railway GraphQL API
    │       └── config fix → GitHub PR (kamu review)
    └── confidence < 85% atau fix berisiko → ESKALASI WA
    ↓
Validator: tunggu app sehat kembali
    ↓
Playbook: simpan pattern fix yang berhasil (belajar otomatis)
```

## Setup

### 1. Deploy ke Railway

```bash
# Clone atau push repo ini ke GitHub
# Buat service baru di Railway, connect repo ini
# Set semua env vars (lihat .env.example)
```

### 2. Env vars wajib

| Variable | Keterangan |
|---|---|
| `DATABASE_URL` | PostgreSQL Railway (buat DB baru khusus healer) |
| `RAILWAY_TOKEN` | Railway API token (Settings → Tokens) |
| `RAILWAY_PROJECT_ID` | ID project Zomet di Railway |
| `LLM_API_KEY` | API key untuk LLM (Anthropic atau 9router) |
| `LLM_BASE_URL` | Base URL LLM |
| `GITHUB_TOKEN` | GitHub PAT dengan scope `repo` |
| `CLAWDBOT_WEBHOOK_URL` | Endpoint clawdbot untuk notif WA |
| `WA_NOTIFY_NUMBER` | Nomor WA tujuan notifikasi |

### 3. Tambah health check endpoint ke setiap app Zomet

```typescript
// app/api/health/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'connected' })
  } catch (err) {
    return NextResponse.json({ status: 'error', db: 'disconnected' }, { status: 500 })
  }
}
```

## API Endpoints

| Endpoint | Method | Keterangan |
|---|---|---|
| `/health` | GET | Status Zomet Healer sendiri |
| `/trigger` | POST | Manual trigger heal loop |
| `/status` | GET | 20 incident terbaru |

## Fix yang di-auto

| Error | Fix |
|---|---|
| `nixpacks.toml` missing | GitHub PR tambah file |
| Lockfile mismatch | Redeploy Railway |
| Build failure (module not found) | GitHub PR fix package.json |
| App unreachable / HTTP 5xx | Redeploy Railway |
| Prisma enum mismatch | Eskalasi WA (terlalu berisiko) |
| DB connection error | Eskalasi WA + cek env vars |
| Schema migration | Eskalasi WA selalu |

## Playbook (self-learning)

Setiap fix yang berhasil disimpan ke tabel `Playbook`. Lama kelamaan, error berulang langsung di-fix tanpa panggil LLM → lebih cepat dan hemat token.
