-- CreateTable
CREATE TABLE "public"."BoardState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "viewport" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardState_workspaceId_key" ON "public"."BoardState"("workspaceId");

-- AddForeignKey
ALTER TABLE "public"."BoardState" ADD CONSTRAINT "BoardState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
