import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";

import { TemplateLauncher } from "./template-launcher";

type TemplatesPageProps = {
  params: Promise<{ workspaceSlug: string }>;
};

export default async function TemplatesPage({ params }: TemplatesPageProps) {
  const { workspaceSlug } = await params;
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true, name: true, slug: true },
  });

  if (!workspace) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-950">Templates</h2>
        <p className="guild-muted mt-2 text-sm">
          Launch polished template systems for workspace{" "}
          <code>{workspace.name}</code>.
        </p>
      </div>

      <TemplateLauncher workspaceSlug={workspace.slug} />
    </div>
  );
}
