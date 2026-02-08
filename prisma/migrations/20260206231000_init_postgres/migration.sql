-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AgentRole" AS ENUM ('EXECUTOR', 'QA', 'MEDIATOR', 'EXEC');

-- CreateEnum
CREATE TYPE "public"."ThinkingProfile" AS ENUM ('FAST', 'STANDARD', 'DEEP');

-- CreateEnum
CREATE TYPE "public"."ChannelVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "public"."MountScope" AS ENUM ('AGENT', 'CHANNEL', 'RUN');

-- CreateEnum
CREATE TYPE "public"."RunTemplate" AS ENUM ('DEBATE', 'ORG', 'GAME', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."RunStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."TurnStatus" AS ENUM ('QUEUED', 'RUNNING', 'BLOCKED', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."VoteStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."PolicyKind" AS ENUM ('APPROVAL', 'VETO', 'ESCALATION', 'CONSENSUS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."PolicyScope" AS ENUM ('WORKSPACE', 'RUN', 'CHANNEL');

-- CreateTable
CREATE TABLE "public"."Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Agent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "public"."AgentRole" NOT NULL,
    "objective" TEXT,
    "authorityWeight" INTEGER NOT NULL DEFAULT 1,
    "thinkingProfile" "public"."ThinkingProfile" NOT NULL DEFAULT 'STANDARD',
    "privateMemoryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Channel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "public"."ChannelVisibility" NOT NULL DEFAULT 'PUBLIC',
    "sourceAgentId" TEXT NOT NULL,
    "targetAgentId" TEXT NOT NULL,
    "allowedMessageTypes" JSONB,
    "readerAgentIds" JSONB,
    "writerAgentIds" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VaultItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "tags" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Mount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "vaultItemId" TEXT NOT NULL,
    "scope" "public"."MountScope" NOT NULL,
    "agentId" TEXT,
    "channelId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Run" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT,
    "template" "public"."RunTemplate" NOT NULL DEFAULT 'CUSTOM',
    "status" "public"."RunStatus" NOT NULL DEFAULT 'DRAFT',
    "boardSnapshot" JSONB,
    "state" JSONB,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Turn" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "actorAgentId" TEXT,
    "channelId" TEXT,
    "status" "public"."TurnStatus" NOT NULL DEFAULT 'QUEUED',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Vote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "public"."VoteStatus" NOT NULL DEFAULT 'OPEN',
    "quorum" INTEGER,
    "threshold" INTEGER,
    "options" JSONB,
    "weights" JSONB,
    "ballots" JSONB,
    "result" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Policy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "public"."PolicyKind" NOT NULL,
    "scope" "public"."PolicyScope" NOT NULL DEFAULT 'WORKSPACE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "channelId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "public"."Workspace"("slug");

-- CreateIndex
CREATE INDEX "Agent_workspaceId_idx" ON "public"."Agent"("workspaceId");

-- CreateIndex
CREATE INDEX "Channel_workspaceId_idx" ON "public"."Channel"("workspaceId");

-- CreateIndex
CREATE INDEX "Channel_sourceAgentId_idx" ON "public"."Channel"("sourceAgentId");

-- CreateIndex
CREATE INDEX "Channel_targetAgentId_idx" ON "public"."Channel"("targetAgentId");

-- CreateIndex
CREATE INDEX "VaultItem_workspaceId_idx" ON "public"."VaultItem"("workspaceId");

-- CreateIndex
CREATE INDEX "Mount_workspaceId_idx" ON "public"."Mount"("workspaceId");

-- CreateIndex
CREATE INDEX "Mount_vaultItemId_idx" ON "public"."Mount"("vaultItemId");

-- CreateIndex
CREATE INDEX "Mount_scope_idx" ON "public"."Mount"("scope");

-- CreateIndex
CREATE INDEX "Run_workspaceId_idx" ON "public"."Run"("workspaceId");

-- CreateIndex
CREATE INDEX "Run_status_idx" ON "public"."Run"("status");

-- CreateIndex
CREATE INDEX "Turn_runId_idx" ON "public"."Turn"("runId");

-- CreateIndex
CREATE INDEX "Turn_actorAgentId_idx" ON "public"."Turn"("actorAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_runId_sequence_key" ON "public"."Turn"("runId", "sequence");

-- CreateIndex
CREATE INDEX "Vote_workspaceId_idx" ON "public"."Vote"("workspaceId");

-- CreateIndex
CREATE INDEX "Vote_runId_idx" ON "public"."Vote"("runId");

-- CreateIndex
CREATE INDEX "Vote_status_idx" ON "public"."Vote"("status");

-- CreateIndex
CREATE INDEX "Policy_workspaceId_idx" ON "public"."Policy"("workspaceId");

-- CreateIndex
CREATE INDEX "Policy_scope_idx" ON "public"."Policy"("scope");

-- AddForeignKey
ALTER TABLE "public"."Agent" ADD CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Channel" ADD CONSTRAINT "Channel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Channel" ADD CONSTRAINT "Channel_sourceAgentId_fkey" FOREIGN KEY ("sourceAgentId") REFERENCES "public"."Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Channel" ADD CONSTRAINT "Channel_targetAgentId_fkey" FOREIGN KEY ("targetAgentId") REFERENCES "public"."Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VaultItem" ADD CONSTRAINT "VaultItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Mount" ADD CONSTRAINT "Mount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Mount" ADD CONSTRAINT "Mount_vaultItemId_fkey" FOREIGN KEY ("vaultItemId") REFERENCES "public"."VaultItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Mount" ADD CONSTRAINT "Mount_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Mount" ADD CONSTRAINT "Mount_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "public"."Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Mount" ADD CONSTRAINT "Mount_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Run" ADD CONSTRAINT "Run_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Turn" ADD CONSTRAINT "Turn_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Turn" ADD CONSTRAINT "Turn_actorAgentId_fkey" FOREIGN KEY ("actorAgentId") REFERENCES "public"."Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Turn" ADD CONSTRAINT "Turn_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "public"."Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Vote" ADD CONSTRAINT "Vote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Vote" ADD CONSTRAINT "Vote_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Policy" ADD CONSTRAINT "Policy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Policy" ADD CONSTRAINT "Policy_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "public"."Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Policy" ADD CONSTRAINT "Policy_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

