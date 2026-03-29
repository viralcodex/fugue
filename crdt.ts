import {
  type Id,
  type Doc,
  type ReplicaState,
  type Node,
  type Operation,
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
  const nodes = traverse("root", state.docTree);
  return nodes.map((node) => node.content ?? "");
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

const findNextNode = (targetId: Id | null, docTree: Map<string, Doc>): Node | null => {
  const values = traverse("root", docTree, true); //include deleted as well

  if (targetId === null) return values[0] ?? null;

  const targetKey = idToKey(targetId); //Id to string

  for (let i = 0; i < values.length - 1; i++) {
    if (idToKey(values[i]!.id) === targetKey) {
      return values[i + 1] ?? null;
    }
  }

  return null;
};

const buildInsertOperation = (
  index: number,
  value: string,
  state: ReplicaState,
): Insert => {
  const counter = state.counter;
  const newId: Id = [state.replicaId, counter];

  state.counter++;

  const values = traverse("root", state.docTree, false);

  if (index < 0 || index > values.length) {
    throw new Error("Invalid index value: " + index);
  }

  const leftOriginNode = index === 0 ? null : values[index - 1];
  const leftOriginId = leftOriginNode ? leftOriginNode.id : null;

  const rightOriginNode = findNextNode(leftOriginId, state.docTree);

  const rightSubTreeForLeftOrigin = state.docTree.get(
    idToKey(leftOriginId),
  )?.rightChildren;

  const rightSubTreeExists =
    rightSubTreeForLeftOrigin && rightSubTreeForLeftOrigin.length > 0;

  //if leftOrigin doesn't have any right subtree, attach the node to its right otherwise, attach it to the left of the right subtree

  let parentId: Id | null;
  let side: "L" | "R";

  if (rightSubTreeExists) {
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
};

const buildDeleteOperation = (index: number, state: ReplicaState): Delete => {
  const values = traverse("root", state.docTree, false); //only visible elements

  if (index < 0 || index >= values.length) {
    throw new Error(`Delete index out of bounds: ${index}`);
  }

  const deletedNode = values[index]!;

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
    throw new Error("No Node found for this key " + targetKey);
  }

  if (nodeToBeDeleted.node.isDeleted) {
    return;
  }

  nodeToBeDeleted.node.isDeleted = true;
};

export const resetAllDocuments = () => {
  replicaStates["A"] = createReplicaState("A");
  replicaStates["B"] = createReplicaState("B");
};

export const insert = (cursor: number, text: string, replicaId: string) => {
  const state = getState(replicaId);
  for (let index = 0; index < text.length; index++) {
    const op = buildInsertOperation(cursor + index, text[index]!, state);
    insertOperation(op, state);
  }
};

export const deletes = (cursor: number, end: number, replicaId: string) => {
  const state = getState(replicaId);
  for (let index = 0; index < end - cursor; index++) {
    const op = buildDeleteOperation(cursor, state);
    deleteOperation(op, state);
  }
}

export const readText = (replicaId: string): string => {
  const state = getState(replicaId);
  return values(state).join("");
};

export const getNodeAtIndex = (index: number, replicaId: string): Node | null => {
  const state = getState(replicaId);
  const nodes = traverse("root", state.docTree, false);
  return nodes[index] ?? null;
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
