import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";

import { RunsConsole } from "./runs-console";

type RunsPageProps = {
  params: Promise<{ workspaceSlug: string }>;
};

export default async function RunsPage({ params }: RunsPageProps) {
  const { workspaceSlug } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true },
  });

  if (!workspace) {
    notFound();
  }

  return (
    <div>
      <RunsConsole workspaceSlug={workspaceSlug} />
    </div>
  );
}
