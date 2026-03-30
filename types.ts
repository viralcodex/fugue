export type RId = string; // replica = device

export type Id = [ RId, number]; //node id

export type Node = {
    readonly id: Id | null;
    readonly parent: Id | null,
    side: 'L' | 'R' | null, //which subtree
    content: string | null,
    isDeleted: boolean;
}

export type Doc = {
    node: Node,
    leftChildren: string[]; //id key string only
    rightChildren: string[];
}

export type ReplicaState = {
    replicaId: RId,
    counter: number,
    docTree: Map<string, Doc>, //per replica doc tree state
    visibleContentCache: Node[] | null,
}

export type Insert = {
    type: "insert",
    node: Node;
}

export type Delete = {
    type: "delete",
    nodeId: Id;
}

export type Operation = Insert | Delete

export type Replica = {
    snapshot: string,
    highlight: HTMLDivElement,
    textArea: HTMLTextAreaElement,
}