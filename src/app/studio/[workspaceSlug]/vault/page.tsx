import { VaultConsole } from "./vault-console";

type VaultPageProps = {
  params: Promise<{ workspaceSlug: string }>;
};

export default async function VaultPage({ params }: VaultPageProps) {
  const { workspaceSlug } = await params;

  return <VaultConsole workspaceSlug={workspaceSlug} />;
}
