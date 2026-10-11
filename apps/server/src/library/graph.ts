/**
 * Map of everything (Library → Graph): an Obsidian-style node graph over the library.
 *
 * Nodes are chats, extracted things ("entities", deduplicated by kind+name so `Widget`
 * mentioned in three chats is one hub) and tags. Both relations already exist in the schema,
 * so no inference is needed:
 *   entity ↔ chat  `entities.itemId = chats.itemId` (each item has exactly one chat)
 *   tag ↔ chat     `item_tags.itemId = chats.itemId`
 * There are deliberately no entity↔tag edges: both already hang off the same chat, and the
 * extra triangles would triple the edge count for no new information.
 *
 * The graph is capped (`GRAPH_CAPS`): the newest `chats` chats, then up to `entities` distinct
 * things, then every tag carried by the capped chats. Anything outside the caps would attach
 * only to a chat that is not in the graph, so it is skipped instead of floating as an orphan.
 * Built from three cheap indexed queries (`listChats` + one `Repo.graphData` batch).
 */

import type { GraphEdge, GraphNode, LibraryGraph } from '@doubletake/shared';
import type { Repo } from '../db/repo.js';

export interface GraphCaps {
  chats: number;
  entities: number;
}

/** Newest ~150 chats, ~200 distinct things; tags are uncapped but only linked ones survive. */
export const GRAPH_CAPS: GraphCaps = { chats: 150, entities: 200 };

export function buildLibraryGraph(repo: Repo, caps: GraphCaps = GRAPH_CAPS): LibraryGraph {
  const chatRows = repo.listChats(caps.chats);
  const chatIdByItem = new Map(chatRows.map((r) => [r.item.id, r.chat.id]));

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const r of chatRows) {
    nodes.push({
      id: `chat:${r.chat.id}`,
      kind: 'chat',
      label: r.item.title ?? r.item.note ?? 'Untitled',
      kindDetail: { chatId: r.chat.id, itemId: r.item.id },
    });
  }

  const { entities, tagLinks } = repo.graphData([...chatIdByItem.keys()], caps.entities);

  // Distinct things first (newest rows win the slot), each with an edge to every capped chat
  // that mentions them — that is what makes hubs the visual centres of the graph.
  const entityNode = new Map<string, GraphNode>();
  for (const e of entities) {
    const chatId = chatIdByItem.get(e.itemId);
    if (!chatId) continue;
    const key = `${e.kind}:${e.name.trim().toLowerCase()}`;
    let node = entityNode.get(key);
    if (!node) {
      if (entityNode.size >= caps.entities) continue;
      node = {
        id: `entity:${key}`,
        kind: 'entity',
        label: e.name,
        kindDetail: { entityKind: e.kind },
      };
      entityNode.set(key, node);
      nodes.push(node);
    }
    edges.push({ source: node.id, target: `chat:${chatId}` });
  }

  const tagNode = new Set<string>();
  for (const t of tagLinks) {
    const chatId = chatIdByItem.get(t.itemId);
    if (!chatId) continue;
    const id = `tag:${t.name}`;
    if (!tagNode.has(id)) {
      tagNode.add(id);
      nodes.push({ id, kind: 'tag', label: t.name, kindDetail: { name: t.name } });
    }
    edges.push({ source: id, target: `chat:${chatId}` });
  }

  return { nodes, edges };
}
