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
    { slug: 'zone',       name: 'Z One',       healthUrl: 'https://zone.zomet.my.id/api/health',       githubRepo: 'ZOne' },
    { slug: 'zpos',       name: 'ZPos',        healthUrl: 'https://zpos.zomet.my.id/api/health',       githubRepo: 'zpos' },
    { slug: 'zgold',      name: 'ZGold',       healthUrl: 'https://zgold.zomet.my.id/api/health',      githubRepo: 'ZGold' },
    { slug: 'zresto',     name: 'Z Resto',     healthUrl: 'https://zresto.zomet.my.id/api/health',     githubRepo: 'Z-Resto' },
    { slug: 'zmedics',    name: 'ZMedics',     healthUrl: 'https://zmedics.zomet.my.id/api/health',    githubRepo: 'z_medics' },
    { slug: 'zbengkel',   name: 'ZBengkel',    healthUrl: 'https://zbengkel.zomet.my.id/api/health',   githubRepo: 'ZBengkel' },
    { slug: 'zrooms',     name: 'Z-Rooms',     healthUrl: 'https://z-rooms.zomet.my.id/api/health',    githubRepo: 'Z-Rooms' },
    { slug: 'zabsen',     name: 'Z-Absen',     healthUrl: 'https://z-absen.zomet.my.id/api/health',    githubRepo: 'Z-Absen' },
    { slug: 'zface',      name: 'ZFace',       healthUrl: 'https://zface.zomet.my.id/api/health',      githubRepo: 'z_face' },
    { slug: 'zgym',       name: 'ZGym',        healthUrl: 'https://zgym.zomet.my.id/api/health',       githubRepo: 'ZGym' },
    { slug: 'zbarber',    name: 'ZBarber',     healthUrl: 'https://zbarber.zomet.my.id/api/health',    githubRepo: 'zbarber' },
    { slug: 'ztransport', name: 'ZTransport',  healthUrl: 'https://ztrans.zomet.my.id/api/health',                         githubRepo: 'ZTransport' },
    { slug: 'zlaundry',   name: 'ZLaundry',    healthUrl: 'https://zlaundry.zomet.my.id/api/health',                       githubRepo: 'ZLaundry' },
    { slug: 'zbilliar',   name: 'ZBilliar',    healthUrl: 'https://zbilliar.zomet.my.id/api/health',                       githubRepo: 'zbilliar' },
    { slug: 'zprint',     name: 'ZPrint',      healthUrl: 'https://zprint.zomet.my.id/api/health',                         githubRepo: 'ZPrint' },
    { slug: 'zwisata',    name: 'ZWisata',     healthUrl: 'https://zwisata.zomet.my.id/api/health',                        githubRepo: 'zwisata' },
    { slug: 'zanalytics', name: 'Z Analytics', healthUrl: 'https://zanalytics.zomet.my.id/api/health',                     githubRepo: 'z_analytics' },
    { slug: 'zadv',       name: 'ZAdv',        healthUrl: 'https://zadv-production.up.railway.app/api/health',             githubRepo: 'Zadv' },
    { slug: 'zbackup',    name: 'ZBackup',     healthUrl: 'https://zbackup-production.up.railway.app/api/health',          githubRepo: null },
    { slug: 'zbanker',    name: 'Z Banker',    healthUrl: 'https://zbanker.zomet.my.id/api/health',                        githubRepo: 'z_banker' },
  ]
}
