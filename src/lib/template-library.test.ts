import { describe, expect, it } from "vitest";

import {
  getTemplateDefinition,
  isTemplateKey,
  listTemplateManifests,
} from "./template-library";

function nodeIds(templateKey: "debate" | "org" | "game" | "build"): Set<string> {
  const template = getTemplateDefinition(templateKey);
  return new Set(template.board.nodes.map((node) => node.id));
}

describe("template-library", () => {
  it("exposes all required templates", () => {
    const manifests = listTemplateManifests();
    const keys = manifests.map((manifest) => manifest.key);

    expect(keys).toEqual(["debate", "org", "game", "build"]);
  });

  it("returns valid board scaffolds for each template", () => {
    for (const key of ["debate", "org", "game", "build"] as const) {
      const template = getTemplateDefinition(key);
      expect(template.board.nodes.length).toBeGreaterThanOrEqual(2);
      expect(template.board.edges.length).toBeGreaterThanOrEqual(1);

      const nodeIds = template.board.nodes.map((node) => node.id);
      const edgeIds = template.board.edges.map((edge) => edge.id);
      expect(new Set(nodeIds).size).toBe(nodeIds.length);
      expect(new Set(edgeIds).size).toBe(edgeIds.length);
    }
  });

  it("flags valid template keys", () => {
    expect(isTemplateKey("debate")).toBe(true);
    expect(isTemplateKey("org")).toBe(true);
    expect(isTemplateKey("game")).toBe(true);
    expect(isTemplateKey("build")).toBe(true);
    expect(isTemplateKey("unknown")).toBe(false);
  });

  it("scaffolds debate with two sides and mediator decision path", () => {
    const template = getTemplateDefinition("debate");
    const ids = nodeIds("debate");
    expect(ids.has("debate-side-a")).toBe(true);
    expect(ids.has("debate-side-b")).toBe(true);
    expect(ids.has("debate-mediator")).toBe(true);

    const mediatorDecisionEdges = template.board.edges.filter(
      (edge) =>
        edge.source === "debate-mediator" &&
        edge.data?.messageTypes.includes("decision"),
    );
    expect(mediatorDecisionEdges.length).toBeGreaterThan(0);
    const finalDecisionEdge = template.board.edges.find(
      (edge) => edge.id === "debate-e7",
    );
    expect(finalDecisionEdge?.data?.stepOrder).toBe(6);
    expect(finalDecisionEdge?.data?.messageTypes).toEqual(["decision"]);
  });

  it("scaffolds org with delegation + escalation loop", () => {
    const template = getTemplateDefinition("org");
    const ids = nodeIds("org");
    expect(ids.has("org-exec")).toBe(true);
    expect(ids.has("org-director")).toBe(true);
    expect(ids.has("org-product")).toBe(true);
    expect(ids.has("org-risk")).toBe(true);
    expect(ids.has("org-operator")).toBe(true);

    const hasEscalationChannel = template.board.edges.some(
      (edge) => edge.source === "org-risk" && edge.target === "org-director",
    );
    const hasFinalDecisionChannel = template.board.edges.some(
      (edge) =>
        edge.source === "org-director" &&
        edge.target === "org-exec" &&
        edge.data?.messageTypes.includes("decision"),
    );
    expect(hasEscalationChannel).toBe(true);
    expect(hasFinalDecisionChannel).toBe(true);
  });

  it("scaffolds game with dealer, players, and referee validation", () => {
    const template = getTemplateDefinition("game");
    const ids = nodeIds("game");
    expect(ids.has("game-dealer")).toBe(true);
    expect(ids.has("game-player-a")).toBe(true);
    expect(ids.has("game-player-b")).toBe(true);
    expect(ids.has("game-referee")).toBe(true);

    const privateDealChannels = template.board.edges.filter(
      (edge) =>
        edge.source === "game-dealer" &&
        edge.data?.visibility === "private" &&
        (edge.target === "game-player-a" || edge.target === "game-player-b"),
    );
    const playerActionChannels = template.board.edges.filter(
      (edge) =>
        (edge.source === "game-player-a" || edge.source === "game-player-b") &&
        edge.target === "game-dealer",
    );
    const dealerToRefereeChannel = template.board.edges.find(
      (edge) => edge.source === "game-dealer" && edge.target === "game-referee",
    );
    const refereeDecisionChannel = template.board.edges.find(
      (edge) =>
        edge.source === "game-referee" &&
        edge.target === "game-dealer" &&
        edge.data?.messageTypes.includes("decision"),
    );
    expect(privateDealChannels).toHaveLength(2);
    expect(
      privateDealChannels.every((edge) => edge.data?.stepOrder === 1),
    ).toBe(true);
    expect(
      privateDealChannels.every(
        (edge) =>
          JSON.stringify(edge.data?.messageTypes) === JSON.stringify(["proposal"]),
      ),
    ).toBe(true);
    expect(playerActionChannels).toHaveLength(2);
    expect(playerActionChannels.every((edge) => edge.data?.stepOrder === 2)).toBe(true);
    expect(dealerToRefereeChannel?.data?.stepOrder).toBe(4);
    expect(refereeDecisionChannel).toBeDefined();
    expect(refereeDecisionChannel?.data?.stepOrder).toBe(5);
  });
});
