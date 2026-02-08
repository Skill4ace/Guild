import { BoardEditor } from "./board-editor";

type BoardPageProps = {
  params: Promise<{ workspaceSlug: string }>;
};

export default async function BoardPage({ params }: BoardPageProps) {
  const { workspaceSlug } = await params;

  return <BoardEditor workspaceSlug={workspaceSlug} />;
}
