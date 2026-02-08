CREATE TYPE "public"."MountAuditAction" AS ENUM ('CREATED', 'REMOVED');

CREATE TABLE "public"."MountAuditEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mountId" TEXT,
    "action" "public"."MountAuditAction" NOT NULL,
    "scope" "public"."MountScope" NOT NULL,
    "vaultItemId" TEXT NOT NULL,
    "agentId" TEXT,
    "channelId" TEXT,
    "runId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MountAuditEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MountAuditEntry_workspaceId_idx" ON "public"."MountAuditEntry"("workspaceId");
CREATE INDEX "MountAuditEntry_createdAt_idx" ON "public"."MountAuditEntry"("createdAt");

ALTER TABLE "public"."MountAuditEntry" ADD CONSTRAINT "MountAuditEntry_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
