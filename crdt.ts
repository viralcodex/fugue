import {
  type Id,
  type Doc,
  type ReplicaState,
  type Node,
  type Insert,
  type Delete,
} from "./types";

const createDoc = (): Doc => {
  return {
    node: {
      id: null,
      parent: null,
      side: null,
      content: "",
      isDeleted: false,
    },
    leftChildren: [],
    rightChildren: [],
  };
};

const createReplicaState = (id: string): ReplicaState => {
  return {
    replicaId: id,
    counter: 0,
    docTree: new Map().set("root", createDoc()),
    visibleContentCache: null,
  };
};

const replicaStates: Record<string, ReplicaState> = {
  A: createReplicaState("A"),
  B: createReplicaState("B"),
};

const getState = (replicaId: string): ReplicaState => {
  const state = replicaStates[replicaId];
  if (!state) {
    throw new Error(`Replica state not found for replicaId: ${replicaId}`);
  }
  return state;
};

const values = (state: ReplicaState): string[] => {
  if (!state.visibleContentCache) cacheReset(state);
  return state.visibleContentCache!.map((node) => node.content ?? "");
};

// DFS
const traverse = (
  nodeID: string | null,
  docTree: ReplicaState["docTree"],
  includeDeleted: boolean = false,
): Node[] => {

  const values: Node[] = [];
  const entry: Doc | undefined = docTree.get(nodeID ?? "root");

  if (!entry) return values;

  for (const childKey of entry.leftChildren) {
    values.push(...traverse(childKey, docTree, includeDeleted));
  }

  //ignore root
  if (entry.node.id !== null) {
    if (includeDeleted || !entry.node.isDeleted) {
      values.push(entry.node);
    }
  }

  for (const childKey of entry.rightChildren) {
    values.push(...traverse(childKey, docTree, includeDeleted));
  }

  return values;
};

// returns the left most descendant of the right subtree of the left origin node
const findLeftMostDescendant = (targetKey: string, docTree: Map<string, Doc>): Node | null => {
  let currentKey = targetKey;

  while (true) {
    const entry = docTree.get(currentKey);
    if (!entry) return null;
    if (entry.leftChildren && entry.leftChildren.length > 0) {
      currentKey = entry.leftChildren[0]!;
    }
    else
      return entry.node;
  }
};

const buildInsertOperation = (
  index: number,
  value: string,
  state: ReplicaState,
): Insert => {
  const counter = state.counter;
  const newId: Id = [state.replicaId, counter];

  state.counter++;

  if (!state.visibleContentCache) cacheReset(state);

  if (index < 0 || index > state.visibleContentCache!.length) {
    throw new Error("Invalid index value: " + index);
  }

  const leftOriginNode = index === 0 ? null : state.visibleContentCache![index - 1];
  const leftOriginId = leftOriginNode ? leftOriginNode.id : null;


  const rightSubTreeForLeftOrigin = state.docTree.get(
    idToKey(leftOriginId),
  )?.rightChildren;

  const rightSubTreeExists = rightSubTreeForLeftOrigin && rightSubTreeForLeftOrigin.length > 0;

  let parentId: Id | null;
  let side: "L" | "R";

  //if leftOrigin doesn't have any right subtree, attach the node to its right otherwise, attach it to the left of the right subtree
  if (rightSubTreeExists) {
    const rightOriginNode = findLeftMostDescendant(rightSubTreeForLeftOrigin[0]!, state.docTree);

    if (!rightOriginNode) throw new Error("No right origin for this subtree");

    parentId = rightOriginNode.id;
    side = "L";
  } else {
    parentId = leftOriginId;
    side = "R";
  }

  const node: Node = {
    id: newId,
    parent: parentId,
    content: value,
    isDeleted: false,
    side: side,
  };

  return {
    type: "insert",
    node: node,
  };
};

const insertOperation = (op: Insert, state: ReplicaState) => {
  const parentKey = idToKey(op.node.parent);
  const parentNode = state.docTree.get(parentKey);

  const nodeId = op.node.id;
  const side = op.node.side;

  if (!parentNode) {
    throw new Error("No parent node found for the id " + parentKey);
  }

  const siblings = side === "R" ? parentNode.rightChildren : parentNode.leftChildren;

  if (siblings.includes(idToKey(nodeId))) {
    throw new Error("NodeId already exists: " + nodeId);
  }

  const insertAt = siblings.findIndex(
    (id) => compareIds(nodeId!, keyToId(id)) < 0,
  );

  if (insertAt === -1) siblings.push(idToKey(nodeId));
  else siblings.splice(insertAt, 0, idToKey(nodeId));

  //add to doctree
  state.docTree.set(idToKey(op.node.id), {
    node: op.node,
    leftChildren: [],
    rightChildren: [],
  });

  cacheReset(state); //rebuild the cache
};

const buildDeleteOperation = (index: number, state: ReplicaState): Delete => {
  if (index < 0 || index >= state.visibleContentCache!.length) {
    throw new Error(`Delete index out of bounds: ${index}`);
  }

  const deletedNode = state.visibleContentCache![index]!;

  if (deletedNode.id === null) {
    throw new Error("Cannot delete root");
  }

  return {
    type: "delete",
    nodeId: deletedNode.id
  };
};

const deleteOperation = (op: Delete, state: ReplicaState) => {
  const targetKey = idToKey(op.nodeId);

  const nodeToBeDeleted = state.docTree.get(targetKey);

  if (!nodeToBeDeleted) {
    throw new Error("No Node found for this key: " + targetKey);
  }

  if (nodeToBeDeleted.node.isDeleted) {
    return;
  }

  nodeToBeDeleted.node.isDeleted = true;

  cacheReset(state); //rebuild the cache
};

export const resetAllDocuments = () => {
  replicaStates["A"] = createReplicaState("A");
  replicaStates["B"] = createReplicaState("B");
};

export const inserts = (cursor: number, text: string, replicaId: string) => {
  const state = getState(replicaId);
  for (let index = 0; index < text.length; index++) {
    const op = buildInsertOperation(cursor + index, text[index]!, state);
    insertOperation(op, state);
  }
};

export const deletes = (start: number, end: number, replicaId: string) => {
  const state = getState(replicaId);
  for (let index = 0; index < end - start; index++) {
    const op = buildDeleteOperation(start, state);
    deleteOperation(op, state);
  }
}

export const readText = (replicaId: string): string => {
  const state = getState(replicaId);
  return values(state).join("");
};

export const getNodeAtIndex = (index: number, replicaId: string): Node | null => {
  const state = getState(replicaId);
  return state.visibleContentCache![index] ?? null;
};

export const mergeDocs = (ltr: boolean = true) => {
  const state1 = getState("A");
  const state2 = getState("B");

  if (ltr) {
    mergeContent(state1, state2);
  }
  else {
    mergeContent(state2, state1);
  }
}

const mergeContent = (srcState: ReplicaState, targetState: ReplicaState) => {
  const missingNodes: Node[] = [];

  const src = srcState.docTree;
  const dest = targetState.docTree;

  for (const [key, value] of src.entries()) {
    if (key === "root") continue; //skip root

    if (!dest.has(key)) {
      missingNodes.push({ ...value.node });
    }
    else if (value.node.isDeleted && !dest.get(key)!.node.isDeleted) {
      dest.get(key)!.node.isDeleted = true;
    }
  }

  const sortedNodes = missingNodes.filter(a => a.id !== null).sort((a, b) => compareIds(a.id!, b.id!));

  sortedNodes.forEach((node) => {
    const insertOp: Insert = { type: "insert", node: node }
    insertOperation(insertOp, targetState);
  })

  cacheReset(targetState); //rebuild the target cache
}

// utils below
const compareIds = (id1: Id, id2: Id) => {
  if (id1[1] !== id2[1]) return id1[1] - id2[1];
  return id1[0].localeCompare(id2[0]);
};

const idToKey = (nodeId: Id | null): string => {
  if (nodeId === null) return "root";
  return `${nodeId[0]}:${nodeId[1]}`;
};

const keyToId = (key: string): Id => {
  if (key === "root") {
    throw new Error("root key does not map to a concrete id tuple");
  }
  const id = key.split(":");
  return [id[0]!, Number(id[1])];
};

const cacheReset = (state: ReplicaState) => {
    state.visibleContentCache = traverse("root", state.docTree);
}