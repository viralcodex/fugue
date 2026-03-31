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
      rightOrigin: null,
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
    fullCache: null,
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

const findSuccessor = (key: string, cache: Node[] | null): Node | null => {
  if (!cache) return null;

  for (let index = 0; index < cache.length - 1; index++) {
    if (cache[index] && idToKey(cache[index]!.id) === key) {
      return cache[index + 1] ?? null;
    }
  }

  return null;
}

//insert
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
  let rightOriginNode;

  //if leftOrigin doesn't have any right subtree, attach the node to its right otherwise, attach it to the left of the right subtree

  if (rightSubTreeExists) {
    rightOriginNode = findLeftMostDescendant(rightSubTreeForLeftOrigin[0]!, state.docTree);
    if (!rightOriginNode) throw new Error("No right origin for this subtree");

    parentId = rightOriginNode.id;
    side = "L";
  } else {
    rightOriginNode = findSuccessor(idToKey(leftOriginId), state.fullCache);
    parentId = leftOriginId;
    side = "R";
  }

  const node: Node = {
    id: newId,
    parent: parentId,
    rightOrigin: rightOriginNode?.id ?? null,
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
  const rightOriginId = op.node.rightOrigin;

  if (!parentNode) {
    throw new Error("No parent node found for the id " + parentKey);
  }

  const siblings = side === "R" ? parentNode.rightChildren : parentNode.leftChildren;

  if (siblings.includes(idToKey(nodeId))) {
    throw new Error("NodeId already exists: " + nodeId);
  }

  let insertAt;
  
  const findIndex = (key: string): number => {
    if (key === "root") { // end of doc from right side = latest
      return state.fullCache?.length ?? -1;
    }
    else {
      return state.fullCache?.findIndex((node) => {
        return key === idToKey(node.id);
      }) ?? -1;
    }
  }

  //fugueMax implementation
  if (side === 'L') {
    insertAt = siblings.findIndex(
      (id) => compareIds(nodeId!, keyToId(id)) < 0,
    );
  } else {
    const rightNodePos = findIndex(idToKey(rightOriginId));

    insertAt = siblings.findIndex(sibId => {
      const sibNode = state.docTree.get(sibId)?.node;

      if (!sibNode) return false;

      const sibPos = findIndex(idToKey(sibNode.rightOrigin));

      if (rightNodePos !== sibPos) return rightNodePos > sibPos;
      else {
        return compareIds(nodeId!, keyToId(sibId)) < 0;
      }
    })
  }

  if (insertAt === -1) {
    siblings.push(idToKey(nodeId));
  } else {
    siblings.splice(insertAt, 0, idToKey(nodeId));
  }

  //add to doctree
  state.docTree.set(idToKey(op.node.id), {
    node: op.node,
    leftChildren: [],
    rightChildren: [],
  });

  cacheReset(state); //rebuild the cache
};

//delete
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
  state.fullCache = traverse("root", state.docTree, true);
  state.visibleContentCache = state.fullCache.filter(node => !node.isDeleted);
}

//exports below

export const resetAllDocuments = () => {
  for (const id of Object.keys(replicaStates)) {
    replicaStates[id] = createReplicaState(id);
  }
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


export const addReplica = (id: string) => {
  if (replicaStates[id]) throw new Error(`Replica ${id} already exists`);
  replicaStates[id] = createReplicaState(id);
};

export const removeReplica = (id: string) => {
  delete replicaStates[id];
};

export const getReplicaIds = (): string[] => Object.keys(replicaStates);

export const mergeDocs = (ltr: boolean = true, srcId?: string, targetId?: string) => {
  const sourceId = srcId ?? (ltr ? "A" : "B");
  const destinationId = targetId ?? (ltr ? "B" : "A");

  mergeContent(getState(sourceId), getState(destinationId));
}

export const syncAllReplicas = () => {
  const ids = Object.keys(replicaStates);
  for (let i = 0; i < ids.length; i++) {
    for (let j = 0; j < ids.length; j++) {
      if (i !== j) {
        mergeContent(getState(ids[i]!), getState(ids[j]!));
      }
    }
  }
}
