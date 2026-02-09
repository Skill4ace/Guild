"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AGENT_ROLE_META,
  AGENT_ROLE_ORDER,
  CHANNEL_MESSAGE_TYPE_META,
  CHANNEL_MESSAGE_TYPE_ORDER,
  AGENT_TOOLING_META,
  AGENT_THINKING_PROFILE_META,
  AGENT_THINKING_PROFILE_ORDER,
  DEFAULT_BOARD_OBJECTIVE,
  type AgentNodeData,
  type AgentRole,
  type ChannelEdgeData,
  type ChannelMessageType,
  createDefaultChannelEdgeData,
  createDefaultAgentNodeData,
  sanitizeChannelEdgeData,
  sanitizeBoardDocument,
  withEdgeLabel,
} from "@/lib/board-state";
import { AgentNode } from "./agent-node";

type BoardEditorProps = {
  workspaceSlug: string;
};

type SaveStatus = "idle" | "loading" | "saving" | "saved" | "error";

type BoardApiResponse = {
  board: unknown;
  updatedAt?: string | null;
};

const nodeTypes: NodeTypes = {
  agent: AgentNode,
};

const MINIMAP_ROLE_COLOR: Record<AgentRole, string> = {
  executive: "#7c3aed",
  director: "#2563eb",
  manager: "#0f766e",
  specialist: "#0f766e",
  operator: "#64748b",
};

const HIERARCHY_SCAFFOLD: Array<{
  role: AgentRole;
  label: string;
  objective: string;
}> = [
  {
    role: "executive",
    label: "Executive Council",
    objective: "Approve final direction and ship/no-ship outcomes.",
  },
  {
    role: "director",
    label: "Program Director",
    objective: "Translate strategy into a clear plan for teams.",
  },
  {
    role: "manager",
    label: "Delivery Manager",
    objective: "Break work into scopes, route dependencies, and report risk.",
  },
  {
    role: "specialist",
    label: "Quality Specialist",
    objective: "Review evidence and block weak or unsupported claims.",
  },
  {
    role: "operator",
    label: "Execution Operator",
    objective: "Carry out implementation tasks and post status updates.",
  },
];

function createNodeId() {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createEdgeId() {
  return `channel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function edgeRouteKey(edge: Pick<Edge<ChannelEdgeData>, "source" | "target">) {
  return `${edge.source}::${edge.target}`;
}

function edgeStepOrder(edge: Edge<ChannelEdgeData>): number | null {
  const stepOrder = sanitizeChannelEdgeData(edge.data, {
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
  }).stepOrder;

  return stepOrder;
}

function compareChannelSteps(a: Edge<ChannelEdgeData>, b: Edge<ChannelEdgeData>): number {
  const stepA = edgeStepOrder(a);
  const stepB = edgeStepOrder(b);
  const rankA = stepA ?? Number.MAX_SAFE_INTEGER;
  const rankB = stepB ?? Number.MAX_SAFE_INTEGER;

  if (rankA !== rankB) {
    return rankA - rankB;
  }

  return a.id.localeCompare(b.id);
}

function applyChannelEdgeLayout(
  inputEdges: Array<Edge<ChannelEdgeData>>,
): Array<Edge<ChannelEdgeData>> {
  const edgesByRoute = new Map<string, Array<Edge<ChannelEdgeData>>>();
  for (const edge of inputEdges) {
    const key = edgeRouteKey(edge);
    const bucket = edgesByRoute.get(key) ?? [];
    bucket.push(edge);
    edgesByRoute.set(key, bucket);
  }

  const laidOutById = new Map<string, Edge<ChannelEdgeData>>();
  for (const bucket of edgesByRoute.values()) {
    const sorted = [...bucket].sort(compareChannelSteps);
    for (let index = 0; index < sorted.length; index += 1) {
      const edge = sorted[index];
      const total = sorted.length;
      const lane = index - (total - 1) / 2;
      const stepPosition = Math.max(0.16, Math.min(0.84, 0.5 + lane * 0.2));
      const offset = 22 + Math.abs(lane) * 14;
      const existingPathOptions =
        (
          edge as Edge<ChannelEdgeData> & { pathOptions?: Record<string, unknown> }
        ).pathOptions ?? {};

      const laidOutEdge = {
        ...edge,
        sourceHandle: undefined,
        targetHandle: undefined,
        type: "smoothstep",
        interactionWidth: 28,
        pathOptions: {
          ...existingPathOptions,
          borderRadius: 10,
          stepPosition,
          offset,
        },
        style: {
          ...(edge.style ?? {}),
          stroke: edge.selected ? "#1d4ed8" : "#2563eb",
          strokeWidth: edge.selected ? 2.6 : 2,
        },
        labelShowBg: true,
        labelBgPadding: [6, 2],
        labelBgBorderRadius: 8,
        labelBgStyle: {
          fill: edge.selected ? "#dbeafe" : "#eff6ff",
          stroke: "#93c5fd",
          strokeWidth: 1,
        },
        labelStyle: {
          ...(edge.labelStyle ?? {}),
          fontSize: 10,
          fontWeight: 600,
        },
      } as Edge<ChannelEdgeData> & { pathOptions?: Record<string, unknown> };

      laidOutById.set(edge.id, withEdgeLabel(laidOutEdge));
    }
  }

  return inputEdges.map((edge) => {
    const laidOut = laidOutById.get(edge.id);
    if (laidOut) {
      return laidOut;
    }

    return withEdgeLabel(edge);
  });
}

function parseConstraintInput(input: string): string[] {
  const chunks = input
    .split(/\n|,/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 12);

  return chunks;
}

function formatConstraintInput(values: string[]): string {
  return values.join("\n");
}

function formatChannelStepOrder(value: number | null): string {
  return value === null ? "auto" : `step ${value}`;
}

function toggleListValue(values: string[], entry: string, checked: boolean): string[] {
  if (checked) {
    if (values.includes(entry)) {
      return values;
    }

    return [...values, entry];
  }

  return values.filter((value) => value !== entry);
}

async function toResponseError(
  response: Response,
  fallbackMessage: string,
): Promise<Error> {
  let message = fallbackMessage;

  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      message = payload.error.trim();
    }
  } catch {
    // Ignore JSON parse errors and use fallback message.
  }

  return new Error(`${message} [${response.status}]`);
}

export function BoardEditor({ workspaceSlug }: BoardEditorProps) {
  const [nodes, setNodes] = useState<Array<Node<AgentNodeData>>>([]);
  const [edges, setEdges] = useState<Array<Edge<ChannelEdgeData>>>([]);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1.05 });
  const [boardObjective, setBoardObjective] = useState(DEFAULT_BOARD_OBJECTIVE);
  const [flowInstanceKey, setFlowInstanceKey] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirtyCounter, setDirtyCounter] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);

  const markDirty = useCallback(() => {
    setDirtyCounter((value) => value + 1);
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.selected),
    [nodes],
  );
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.selected),
    [edges],
  );

  const onNodesChange = useCallback(
    (changes: Array<NodeChange<Node<AgentNodeData>>>) => {
      setNodes((current) =>
        applyNodeChanges<Node<AgentNodeData>>(changes, current),
      );

      if (changes.some((change) => change.type !== "select")) {
        setDirtyCounter((value) => value + 1);
      }
    },
    [],
  );

  const onEdgesChange = useCallback(
    (changes: Array<EdgeChange<Edge<ChannelEdgeData>>>) => {
      setEdges((current) =>
        applyChannelEdgeLayout(
          applyEdgeChanges<Edge<ChannelEdgeData>>(changes, current),
        ),
      );

      if (changes.some((change) => change.type !== "select")) {
        setDirtyCounter((value) => value + 1);
      }
    },
    [],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      if (connection.source === connection.target) {
        return;
      }

      const newEdge = withEdgeLabel({
        id: createEdgeId(),
        source: connection.source,
        target: connection.target,
        sourceHandle: undefined,
        targetHandle: undefined,
        data: createDefaultChannelEdgeData(connection.source, connection.target),
      } as Edge<ChannelEdgeData>);

      setEdges((current) => applyChannelEdgeLayout([...current, newEdge]));
      setDirtyCounter((value) => value + 1);
    },
    [],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge<ChannelEdgeData>, connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      if (connection.source === connection.target) {
        return;
      }

      const nextConnection: Connection = {
        ...connection,
        sourceHandle: null,
        targetHandle: null,
      };

      setEdges((current) =>
        applyChannelEdgeLayout(
          reconnectEdge(oldEdge, nextConnection, current).map((edge) =>
            withEdgeLabel(edge),
          ),
        ),
      );
      setDirtyCounter((value) => value + 1);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadBoard() {
      setSaveStatus("loading");
      setSaveError(null);
      setIsHydrated(false);

      try {
        const response = await fetch(`/api/workspaces/${workspaceSlug}/board`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw await toResponseError(response, "Failed to load board");
        }

        const payload = (await response.json()) as BoardApiResponse;
        const board = sanitizeBoardDocument(payload.board);

        if (cancelled) {
          return;
        }

        setNodes(board.nodes);
        setEdges(
          applyChannelEdgeLayout(
            board.edges.map((edge) =>
              withEdgeLabel({
                ...edge,
                sourceHandle: undefined,
                targetHandle: undefined,
              }),
            ),
          ),
        );
        setViewport(board.viewport);
        setBoardObjective(board.objective);
        setFlowInstanceKey((value) => value + 1);
        setSaveStatus("saved");
        setDirtyCounter(0);
        setIsHydrated(true);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setNodes([]);
        setEdges([]);
        setViewport({ x: 0, y: 0, zoom: 1.05 });
        setBoardObjective(DEFAULT_BOARD_OBJECTIVE);
        setSaveError(error instanceof Error ? error.message : "Failed to load board");
        setSaveStatus("error");
      }
    }

    loadBoard();

    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  useEffect(() => {
    if (!isHydrated || dirtyCounter === 0) {
      return;
    }

    setSaveStatus("saving");
    setSaveError(null);

    const timeout = setTimeout(async () => {
      try {
        const payload = {
          version: 1,
          objective: boardObjective,
          nodes: nodes.map((node) => ({
            id: node.id,
            position: node.position,
            data: node.data,
            type: "agent",
          })),
          edges: edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            data: edge.data,
            type: "smoothstep",
          })),
          viewport,
        };

        const response = await fetch(`/api/workspaces/${workspaceSlug}/board`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw await toResponseError(response, "Save failed");
        }

        setSaveStatus("saved");
        setDirtyCounter(0);
      } catch (error) {
        setSaveStatus("error");
        setSaveError(error instanceof Error ? error.message : "Save failed");
      }
    }, 700);

    return () => clearTimeout(timeout);
  }, [boardObjective, dirtyCounter, edges, isHydrated, nodes, viewport, workspaceSlug]);

  function addAgentNode() {
    const nextIndex = nodes.length + 1;
    const role =
      AGENT_ROLE_ORDER[Math.min(nextIndex - 1, AGENT_ROLE_ORDER.length - 1)] ??
      "operator";
    const sameRoleCount = nodes.filter((node) => node.data.role === role).length;
    const roleName = AGENT_ROLE_META[role].label.split(" - ")[1] ?? "Agent";
    const defaultData = createDefaultAgentNodeData(
      role,
      `${roleName} ${sameRoleCount + 1}`,
    );

    const newNode: Node<AgentNodeData> = {
      id: createNodeId(),
      type: "agent",
      position: {
        x: 120 + (sameRoleCount % 4) * 280,
        y: 80 + Math.min(AGENT_ROLE_ORDER.indexOf(role), 4) * 135,
      },
      data: defaultData,
    };

    setNodes((current) => [...current, newNode]);
    markDirty();
  }

  function addHierarchyScaffold() {
    const currentMaxX =
      nodes.length === 0
        ? 0
        : Math.max(...nodes.map((node) => node.position.x));
    const baseX = nodes.length === 0 ? 120 : currentMaxX + 420;
    const baseY = 80;

    const nextNodes: Array<Node<AgentNodeData>> = HIERARCHY_SCAFFOLD.map(
      (entry, index) => {
        const isRightColumn = index % 2 === 0;
        return {
          id: createNodeId(),
          type: "agent",
          position: {
            x: baseX + (isRightColumn ? 230 : 0),
            y: baseY + index * 135,
          },
          data: {
            ...createDefaultAgentNodeData(entry.role, entry.label),
            objective: entry.objective,
          },
        } satisfies Node<AgentNodeData>;
      },
    );

    const nextEdges: Array<Edge<ChannelEdgeData>> = [];
    for (let index = 0; index < nextNodes.length - 1; index += 1) {
      const sourceNode = nextNodes[index];
      const targetNode = nextNodes[index + 1];

      nextEdges.push(
        withEdgeLabel({
          id: createEdgeId(),
          source: sourceNode.id,
          target: targetNode.id,
          sourceHandle: undefined,
          targetHandle: undefined,
          data: {
            stepOrder: index + 1,
            visibility: "public",
            messageTypes: ["proposal", "critique"],
            writerNodeIds: [sourceNode.id, targetNode.id],
            readerNodeIds: [],
          },
        } as Edge<ChannelEdgeData>),
      );
    }

    setNodes((current) => [...current, ...nextNodes]);
    setEdges((current) => applyChannelEdgeLayout([...current, ...nextEdges]));
    markDirty();
  }

  function deleteSelectedNode() {
    if (!selectedNode) {
      return;
    }

    const nodeId = selectedNode.id;
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) =>
      applyChannelEdgeLayout(
        current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      ),
    );
    markDirty();
  }

  function deleteSelectedEdge() {
    if (!selectedEdge) {
      return;
    }

    const edgeId = selectedEdge.id;
    setEdges((current) =>
      applyChannelEdgeLayout(current.filter((edge) => edge.id !== edgeId)),
    );
    markDirty();
  }

  function updateSelectedNodeField(
    field: "label" | "objective" | "persona",
    value: string,
  ) {
    if (!selectedNode) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                [field]: value,
              },
            }
          : node,
      ),
    );
    markDirty();
  }

  function updateBoardObjective(value: string) {
    setBoardObjective(value);
    markDirty();
  }

  function updateSelectedNodeRole(role: AgentRole) {
    if (!selectedNode) {
      return;
    }

    const defaults = createDefaultAgentNodeData(role, selectedNode.data.label);
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                role,
                authorityWeight: defaults.authorityWeight,
                thinkingProfile: defaults.thinkingProfile,
                privateMemoryEnabled: defaults.privateMemoryEnabled,
              },
            }
          : node,
      ),
    );
    markDirty();
  }

  function updateSelectedNodeAuthorityWeight(value: number) {
    if (!selectedNode) {
      return;
    }

    const authorityWeight = Math.max(1, Math.min(10, Math.round(value)));
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                authorityWeight,
              },
            }
          : node,
      ),
    );
    markDirty();
  }

  function updateSelectedNodeThinkingProfile(
    value: AgentNodeData["thinkingProfile"],
  ) {
    if (!selectedNode) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                thinkingProfile: value,
              },
            }
          : node,
      ),
    );
    markDirty();
  }

  function updateSelectedNodePrivateMemory(value: boolean) {
    if (!selectedNode) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                privateMemoryEnabled: value,
              },
            }
          : node,
      ),
    );
    markDirty();
  }

  function updateSelectedNodeTool(
    field: keyof AgentNodeData["tools"],
    value: boolean,
  ) {
    if (!selectedNode) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                tools: {
                  ...node.data.tools,
                  [field]: value,
                },
              },
            }
          : node,
      ),
    );
    markDirty();
  }

  function updateSelectedNodeConstraints(value: string) {
    if (!selectedNode) {
      return;
    }

    const constraints = parseConstraintInput(value);
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                constraints,
              },
            }
          : node,
      ),
    );
    markDirty();
  }

  function updateSelectedEdgeVisibility(value: "public" | "private") {
    if (!selectedEdge) {
      return;
    }

    setEdges((current) =>
      applyChannelEdgeLayout(
        current.map((edge) => {
          if (edge.id !== selectedEdge.id) {
            return edge;
          }

          const currentPolicy = sanitizeChannelEdgeData(edge.data, {
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
          });

          return withEdgeLabel({
            ...edge,
            data: {
              ...currentPolicy,
              visibility: value,
            },
          });
        }),
      ),
    );
    markDirty();
  }

  function updateSelectedEdgeStepOrder(value: string) {
    if (!selectedEdge) {
      return;
    }

    const trimmed = value.trim();
    const parsed =
      trimmed.length === 0 ? null : Math.max(1, Math.min(999, Math.round(Number(trimmed))));
    const stepOrder =
      parsed === null || Number.isNaN(parsed) || !Number.isFinite(parsed)
        ? null
        : parsed;

    setEdges((current) =>
      applyChannelEdgeLayout(
        current.map((edge) => {
          if (edge.id !== selectedEdge.id) {
            return edge;
          }

          const currentPolicy = sanitizeChannelEdgeData(edge.data, {
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
          });

          return withEdgeLabel({
            ...edge,
            data: {
              ...currentPolicy,
              stepOrder,
            },
          });
        }),
      ),
    );
    markDirty();
  }

  function toggleSelectedEdgeMessageType(messageType: ChannelMessageType) {
    if (!selectedEdge) {
      return;
    }

    setEdges((current) =>
      applyChannelEdgeLayout(
        current.map((edge) => {
          if (edge.id !== selectedEdge.id) {
            return edge;
          }

          const currentPolicy = sanitizeChannelEdgeData(edge.data, {
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
          });
          const nextTypes = toggleListValue(
            currentPolicy.messageTypes,
            messageType,
            !currentPolicy.messageTypes.includes(messageType),
          ) as ChannelMessageType[];

          return withEdgeLabel({
            ...edge,
            data: {
              ...currentPolicy,
              messageTypes: nextTypes.length > 0 ? nextTypes : ["proposal"],
            },
          });
        }),
      ),
    );
    markDirty();
  }

  function toggleSelectedEdgeAclNode(
    field: "readerNodeIds" | "writerNodeIds",
    nodeId: string,
    checked: boolean,
  ) {
    if (!selectedEdge) {
      return;
    }

    setEdges((current) =>
      applyChannelEdgeLayout(
        current.map((edge) => {
          if (edge.id !== selectedEdge.id) {
            return edge;
          }

          const currentPolicy = sanitizeChannelEdgeData(edge.data, {
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
          });
          const nextList = toggleListValue(currentPolicy[field], nodeId, checked);
          const fallbackWriters = [edge.source, edge.target].filter(
            (value, index, collection) => collection.indexOf(value) === index,
          );

          return withEdgeLabel({
            ...edge,
            data: {
              ...currentPolicy,
              [field]:
                field === "writerNodeIds" && nextList.length === 0
                  ? fallbackWriters
                  : nextList,
            },
          });
        }),
      ),
    );
    markDirty();
  }

  function selectEdgeById(edgeId: string) {
    setEdges((current) =>
      applyChannelEdgeLayout(
        current.map((edge) => ({
          ...edge,
          selected: edge.id === edgeId,
        })),
      ),
    );
    setNodes((current) =>
      current.map((node) => ({ ...node, selected: false })),
    );
  }

  const nodeIdSet = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const selectedEdgePolicy = selectedEdge
    ? sanitizeChannelEdgeData(selectedEdge.data, {
        sourceNodeId: selectedEdge.source,
        targetNodeId: selectedEdge.target,
        allowedNodeIds: nodeIdSet,
      })
    : null;
  const selectedEdgeSourceNode = selectedEdge
    ? nodes.find((node) => node.id === selectedEdge.source)
    : null;
  const selectedEdgeTargetNode = selectedEdge
    ? nodes.find((node) => node.id === selectedEdge.target)
    : null;
  const selectedConstraintInput = selectedNode
    ? formatConstraintInput(selectedNode.data.constraints)
    : "";
  const channelInspectorEdges = useMemo(
    () =>
      [...edges].sort((a, b) => {
        const stepA = edgeStepOrder(a);
        const stepB = edgeStepOrder(b);
        const rankA = stepA ?? Number.MAX_SAFE_INTEGER;
        const rankB = stepB ?? Number.MAX_SAFE_INTEGER;

        if (rankA !== rankB) {
          return rankA - rankB;
        }

        return a.id.localeCompare(b.id);
      }),
    [edges],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px] xl:items-start">
      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-[0.16em] text-orange-700">
            MISSION
          </p>
          <textarea
            value={boardObjective}
            onChange={(event) => updateBoardObjective(event.target.value)}
            className="mt-2 h-24 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            placeholder="State the single mission this run must solve."
          />
        </section>

        <div className="mt-2 h-[78vh] min-h-[560px] overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {saveStatus === "loading" ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Loading board...
            </div>
          ) : (
            <ReactFlow
              key={`${workspaceSlug}-${flowInstanceKey}`}
              defaultViewport={viewport}
              connectionMode={ConnectionMode.Loose}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              edgesReconnectable
              reconnectRadius={18}
              onNodeClick={(_, clickedNode) => {
                setNodes((current) =>
                  current.map((node) => ({
                    ...node,
                    selected: node.id === clickedNode.id,
                  })),
                );
                setEdges((current) =>
                  applyChannelEdgeLayout(
                    current.map((edge) => ({ ...edge, selected: false })),
                  ),
                );
              }}
              onEdgeClick={(_, clickedEdge) => {
                selectEdgeById(clickedEdge.id);
              }}
              onPaneClick={() => {
                setNodes((current) =>
                  current.map((node) => ({ ...node, selected: false })),
                );
                setEdges((current) =>
                  applyChannelEdgeLayout(
                    current.map((edge) => ({ ...edge, selected: false })),
                  ),
                );
              }}
              onMoveEnd={(_, nextViewport) => {
                setViewport((current) => {
                  if (
                    current.x === nextViewport.x &&
                    current.y === nextViewport.y &&
                    current.zoom === nextViewport.zoom
                  ) {
                    return current;
                  }

                  markDirty();
                  return nextViewport;
                });
              }}
              fitView={nodes.length === 0}
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.45}
              maxZoom={2}
              snapToGrid
              snapGrid={[20, 20]}
              className="bg-gradient-to-b from-sky-50/70 to-slate-100/85"
              proOptions={{ hideAttribution: true }}
            >
              <MiniMap
                pannable
                zoomable
                className="!rounded-lg !border !border-slate-200 !bg-white/95"
                nodeColor={(node) => {
                  const role = (node.data as AgentNodeData | undefined)?.role;
                  return role ? MINIMAP_ROLE_COLOR[role] : "#94a3b8";
                }}
              />
              <Background
                variant={BackgroundVariant.Dots}
                size={1.6}
                gap={20}
                color="#bfdbfe"
              />
              <Controls />
            </ReactFlow>
          )}
        </div>
      </div>

      <aside className="space-y-4">

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Connect Nodes</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addAgentNode}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
            >
              Add agent
            </button>
            <button
              type="button"
              onClick={addHierarchyScaffold}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Add hierarchy scaffold
            </button>
            <button
              type="button"
              onClick={deleteSelectedNode}
              disabled={!selectedNode}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete agent
            </button>
            <button
              type="button"
              onClick={deleteSelectedEdge}
              disabled={!selectedEdge}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete edge
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Drag from one handle to another.</p>
          {saveStatus === "error" && saveError ? (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
              {saveError}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Node Inspector</h3>
          {!selectedNode ? (
            <p className="mt-2 text-xs text-slate-500">
              Select a node to edit label, role, and objective.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Label</span>
                <input
                  type="text"
                  value={selectedNode.data.label}
                  onChange={(event) =>
                    updateSelectedNodeField("label", event.target.value)
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Role</span>
                <select
                  value={selectedNode.data.role}
                  onChange={(event) =>
                    updateSelectedNodeRole(event.target.value as AgentRole)
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                >
                  {AGENT_ROLE_ORDER.map((role) => (
                    <option key={role} value={role}>
                      {AGENT_ROLE_META[role].label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">
                    Decision authority (1-10)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={selectedNode.data.authorityWeight}
                    onChange={(event) =>
                      updateSelectedNodeAuthorityWeight(Number(event.target.value))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">
                    Thinking profile
                  </span>
                  <select
                    value={selectedNode.data.thinkingProfile}
                    onChange={(event) =>
                      updateSelectedNodeThinkingProfile(
                        event.target.value as AgentNodeData["thinkingProfile"],
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  >
                    {AGENT_THINKING_PROFILE_ORDER.map((profile) => (
                      <option key={profile} value={profile}>
                        {AGENT_THINKING_PROFILE_META[profile].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">
                  Private memory
                </span>
                <span className="mt-1 flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedNode.data.privateMemoryEnabled}
                    onChange={(event) =>
                      updateSelectedNodePrivateMemory(event.target.checked)
                    }
                    className="h-4 w-4 accent-slate-900"
                  />
                  Only this agent can use private notes
                </span>
              </label>
              <fieldset>
                <span className="text-xs font-medium text-slate-600">
                  Agent tools
                </span>
                <div className="mt-2 space-y-2">
                  {(Object.keys(AGENT_TOOLING_META) as Array<
                    keyof AgentNodeData["tools"]
                  >).map((toolKey) => {
                    const meta = AGENT_TOOLING_META[toolKey];
                    const checked = selectedNode.data.tools[toolKey];

                    return (
                      <label
                        key={toolKey}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-2.5 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            updateSelectedNodeTool(toolKey, event.target.checked)
                          }
                          className="mt-0.5 h-4 w-4 accent-slate-900"
                        />
                        <span>
                          <span className="block text-xs font-semibold text-slate-900">
                            {meta.label}
                          </span>
                          <span className="block text-[11px] text-slate-500">
                            {meta.summary}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Agent task</span>
                <textarea
                  value={selectedNode.data.objective}
                  onChange={(event) =>
                    updateSelectedNodeField("objective", event.target.value)
                  }
                  className="mt-1 h-20 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  placeholder="What this agent must contribute toward the board objective."
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Persona</span>
                <textarea
                  value={selectedNode.data.persona}
                  onChange={(event) =>
                    updateSelectedNodeField("persona", event.target.value)
                  }
                  className="mt-1 h-20 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  placeholder="Communication style, priorities, and behavior."
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">
                  Constraints (one per line)
                </span>
                <textarea
                  value={selectedConstraintInput}
                  onChange={(event) =>
                    updateSelectedNodeConstraints(event.target.value)
                  }
                  className="mt-1 h-20 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  placeholder={"No unauthorized actions\nCite evidence before approval"}
                />
              </label>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Channel Inspector</h3>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
            {edges.length === 0 ? (
              <p className="text-xs text-slate-500">No channels yet.</p>
            ) : (
              channelInspectorEdges.map((edge, index) => {
                const policy = sanitizeChannelEdgeData(edge.data, {
                  sourceNodeId: edge.source,
                  targetNodeId: edge.target,
                  allowedNodeIds: nodeIdSet,
                });
                const sourceLabel =
                  nodes.find((node) => node.id === edge.source)?.data.label ??
                  edge.source;
                const targetLabel =
                  nodes.find((node) => node.id === edge.target)?.data.label ??
                  edge.target;

                return (
                  <button
                    key={edge.id}
                    type="button"
                    onClick={() => selectEdgeById(edge.id)}
                    className={`w-full rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                      edge.selected
                        ? "border-blue-300 bg-blue-50 text-blue-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <p className="font-semibold">
                      C{index + 1}: {sourceLabel} to {targetLabel}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {formatChannelStepOrder(policy.stepOrder)} | {policy.visibility} |{" "}
                      {policy.messageTypes.join(", ")}
                    </p>
                  </button>
                );
              })
            )}
          </div>
          {!selectedEdge ? (
            <p className="mt-2 text-xs text-slate-500">
              Select a channel.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Route:{" "}
                <span className="font-semibold text-slate-900">
                  {selectedEdgeSourceNode?.data.label ?? selectedEdge.source}
                </span>{" "}
                to{" "}
                <span className="font-semibold text-slate-900">
                  {selectedEdgeTargetNode?.data.label ?? selectedEdge.target}
                </span>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">
                  Step order (blank = auto priority)
                </span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={selectedEdgePolicy?.stepOrder ?? ""}
                  onChange={(event) => updateSelectedEdgeStepOrder(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  placeholder="Auto"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Visibility</span>
                <select
                  value={selectedEdgePolicy?.visibility ?? "public"}
                  onChange={(event) =>
                    updateSelectedEdgeVisibility(
                      event.target.value as "public" | "private",
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                >
                  <option value="public">public</option>
                  <option value="private">private</option>
                </select>
              </label>

              <fieldset>
                <span className="text-xs font-medium text-slate-600">
                  Allowed message types
                </span>
                <div className="mt-2 space-y-2">
                  {CHANNEL_MESSAGE_TYPE_ORDER.map((messageType) => {
                    const checked =
                      selectedEdgePolicy?.messageTypes.includes(messageType) ?? false;
                    const meta = CHANNEL_MESSAGE_TYPE_META[messageType];

                    return (
                      <label
                        key={messageType}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-2.5 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelectedEdgeMessageType(messageType)}
                          className="mt-0.5 h-4 w-4 accent-slate-900"
                        />
                        <span>
                          <span className="block text-xs font-semibold text-slate-900">
                            {meta.label}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <span className="text-xs font-medium text-slate-600">
                  Writers (who can post into this channel)
                </span>
                <div className="mt-2 space-y-1.5">
                  {nodes.map((node) => (
                    <label
                      key={`writer-${node.id}`}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={
                          selectedEdgePolicy?.writerNodeIds.includes(node.id) ?? false
                        }
                        onChange={(event) =>
                          toggleSelectedEdgeAclNode(
                            "writerNodeIds",
                            node.id,
                            event.target.checked,
                          )
                        }
                        className="h-4 w-4 accent-slate-900"
                      />
                      {node.data.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <span className="text-xs font-medium text-slate-600">
                  Readers (who can read channel traffic)
                </span>
                <div className="mt-2 space-y-1.5">
                  {nodes.map((node) => (
                    <label
                      key={`reader-${node.id}`}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={
                          selectedEdgePolicy?.readerNodeIds.includes(node.id) ?? false
                        }
                        onChange={(event) =>
                          toggleSelectedEdgeAclNode(
                            "readerNodeIds",
                            node.id,
                            event.target.checked,
                          )
                        }
                        className="h-4 w-4 accent-slate-900"
                      />
                      {node.data.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </section>

      </aside>
    </div>
  );
}
