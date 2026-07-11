# Template Health Endpoint untuk App Zomet

Tambahkan file ini ke setiap app Zomet di path:
`app/api/health/route.ts`

---

## Versi Basic (semua app)

```typescript
// app/api/health/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({
      status: 'ok',
      db: 'connected',
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      db: 'disconnected',
      error: err instanceof Error ? err.message : 'unknown'
    }, { status: 500 })
  }
}
```

---

## Versi Lengkap (dengan info app)

```typescript
// app/api/health/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const start = Date.now()

  try {
    await prisma.$queryRaw`SELECT 1`
    const dbLatency = Date.now() - start

    return NextResponse.json({
      status: 'ok',
      db: 'connected',
      dbLatencyMs: dbLatency,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
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
```

---

## Kalau prisma path berbeda

Sesuaikan import prisma:
- `@/lib/prisma` — paling umum
- `@/lib/db` — beberapa app pakai ini
- `~/lib/prisma` — kalau tanpa path alias

---

## App yang perlu ditambah

- [ ] Z One     → zone.zomet.my.id
- [ ] ZPos      → zpos.zomet.my.id
- [ ] ZGold     → zgold.zomet.my.id
- [ ] Z Resto   → zresto.zomet.my.id
- [ ] ZMedics   → zmedics.zomet.my.id
- [ ] ZBengkel  → zbengkel.zomet.my.id
- [ ] Z-Rooms   → z-rooms.zomet.my.id
- [ ] Z-Absen   → z-absen.zomet.my.id
- [ ] ZFace     → zface.zomet.my.id (FastAPI — beda format, lihat bawah)

---

## ZFace (FastAPI)

ZFace pakai FastAPI bukan Next.js, tambahkan di `main.py`:

```python
@app.get("/api/health")
async def health():
    try:
        # test koneksi DB
        await database.execute("SELECT 1")
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "db": "disconnected", "error": str(e)}
        )
```
