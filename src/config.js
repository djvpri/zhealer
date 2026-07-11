require('dotenv').config()

module.exports = {
  // Server
  PORT: process.env.PORT || 3000,

  // Railway API
  RAILWAY_API_URL: 'https://backboard.railway.app/graphql/v2',
  RAILWAY_TOKEN: process.env.RAILWAY_TOKEN,
  // Tidak perlu PROJECT_ID manual — healer akan auto-fetch semua project via API

  // LLM - 9router atau Anthropic
  LLM_BASE_URL: process.env.LLM_BASE_URL || 'https://api.anthropic.com',
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL || 'claude-sonnet-4-6',

  // GitHub
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_USERNAME: 'djvpri',

  // Healer settings
  CRON_INTERVAL: process.env.CRON_INTERVAL || '*/30 * * * *', // tiap 30 menit
  HEALTH_CHECK_TIMEOUT: 10000, // 10 detik
  MAX_AUTO_FIX_CONFIDENCE: 0.85, // hanya auto-fix kalau confidence >= 85%
  MAX_RETRIES: 2, // max retry fix sebelum eskalasi

  // Semua Zomet apps yang dimonitor
  ZOMET_APPS: [
    { slug: 'zone',      name: 'Z One SSO',    healthUrl: 'https://zone.zomet.my.id/api/health' },
    { slug: 'zpos',      name: 'ZPos',         healthUrl: 'https://zpos.zomet.my.id/api/health' },
    { slug: 'zgold',     name: 'ZGold',        healthUrl: 'https://zgold.zomet.my.id/api/health' },
    { slug: 'zresto',    name: 'Z Resto',      healthUrl: 'https://zresto.zomet.my.id/api/health' },
    { slug: 'zmedics',   name: 'ZMedics',      healthUrl: 'https://zmedics.zomet.my.id/api/health' },
    { slug: 'zbengkel',  name: 'ZBengkel',     healthUrl: 'https://zbengkel.zomet.my.id/api/health' },
    { slug: 'zrooms',    name: 'Z-Rooms',      healthUrl: 'https://z-rooms.zomet.my.id/api/health' },
    { slug: 'zabsen',    name: 'Z-Absen',      healthUrl: 'https://z-absen.zomet.my.id/api/health' },
    { slug: 'zface',     name: 'ZFace',        healthUrl: 'https://zface.zomet.my.id/api/health' },
    { slug: 'zgym',      name: 'ZGym',         healthUrl: null },
    { slug: 'zbarber',   name: 'ZBarber',      healthUrl: null },
    { slug: 'ztransport',name: 'ZTransport',   healthUrl: null },
    { slug: 'zlaundry',  name: 'ZLaundry',     healthUrl: null },
  ]
}
