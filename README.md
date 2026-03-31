# Fugue CRDT Text Editor

A minimal implementation of the [Fugue CRDT](https://arxiv.org/abs/2305.00583) (and FugueMax in extension) CRDT for collaborative text editing, built with TypeScript and Vite.

## What it does

Independent replicas, each maintain their own document tree. You can type in either editor and merge changes in either direction — the Fugue CRDT guarantees convergence without conflicts.

## How it works

- Each character is a node in a tree, identified by a unique `(replicaId, counter)` pair. (replica = device)
- Inserts attach new nodes relative to a left origin, choosing the left or right subtree to preserve intention.
- Deletes are tombstoned (marked as deleted but kept in the tree) so merges stay consistent.
- Merging replays missing nodes from one replica into the other, sorted by ID to ensure deterministic ordering.

## Getting started

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. 
Type in any text area or create new replicas, then use the merge buttons to sync.
