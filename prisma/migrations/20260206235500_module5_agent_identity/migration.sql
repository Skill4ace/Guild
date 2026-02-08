ALTER TABLE "Agent" ADD COLUMN "boardNodeId" TEXT;
ALTER TABLE "Agent" ADD COLUMN "persona" TEXT;
ALTER TABLE "Agent" ADD COLUMN "constraints" JSONB;

ALTER TYPE "AgentRole" RENAME TO "AgentRole_old";

CREATE TYPE "AgentRole" AS ENUM (
  'EXECUTIVE',
  'DIRECTOR',
  'MANAGER',
  'SPECIALIST',
  'OPERATOR'
);

ALTER TABLE "Agent"
  ALTER COLUMN "role" TYPE "AgentRole"
  USING (
    CASE "role"::TEXT
      WHEN 'EXEC' THEN 'EXECUTIVE'
      WHEN 'MEDIATOR' THEN 'DIRECTOR'
      WHEN 'QA' THEN 'SPECIALIST'
      WHEN 'EXECUTOR' THEN 'OPERATOR'
      ELSE 'MANAGER'
    END
  )::"AgentRole";

DROP TYPE "AgentRole_old";

CREATE UNIQUE INDEX "Agent_workspaceId_boardNodeId_key"
ON "Agent"("workspaceId", "boardNodeId");
