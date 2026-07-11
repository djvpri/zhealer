-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "errorRaw" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "fixType" TEXT,
    "fixResult" TEXT,
    "prUrl" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "playbookId" TEXT,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playbook" (
    "id" TEXT NOT NULL,
    "errorPattern" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "fixType" TEXT NOT NULL,
    "fixPayload" JSONB NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsed" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZometApp" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "healthUrl" TEXT,
    "githubRepo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastChecked" TIMESTAMP(3),
    "lastStatus" TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZometApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Playbook_errorPattern_key" ON "Playbook"("errorPattern");

-- CreateIndex
CREATE UNIQUE INDEX "ZometApp_slug_key" ON "ZometApp"("slug");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
