ALTER TABLE "Channel" ADD COLUMN "boardEdgeId" TEXT;

CREATE UNIQUE INDEX "Channel_workspaceId_boardEdgeId_key"
ON "Channel"("workspaceId", "boardEdgeId");
