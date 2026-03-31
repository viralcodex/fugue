import { deletes, readText, resetAllDocuments, inserts, mergeDocs, syncAllReplicas, getNodeAtIndex, addReplica, getReplicaIds } from "./crdt";
import type { Replica } from "./types";

const areas = document.getElementById("areas") as HTMLSelectElement | null;
const addButton = document.getElementById("add") as HTMLButtonElement | null;
const syncAllBtn = document.getElementById("syncAll") as HTMLButtonElement | null;
const resetAll = document.getElementById("resetAll") as HTMLButtonElement | null;
const node = document.getElementById("node") as HTMLDivElement | null;

const srcSelect = document.getElementById("srcReplica") as HTMLSelectElement | null;
const targetSelect = document.getElementById("targetReplica") as HTMLSelectElement | null;
const mergePairBtn = document.getElementById("mergePair") as HTMLButtonElement | null;

if (!areas || !addButton || !syncAllBtn || !resetAll || !node || !srcSelect || !targetSelect || !mergePairBtn)
  throw new Error("Elements not present")

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const replicas: Record<string, Replica> = {};
let replicaCounter = 0;

const nextId = (): string => {
  if (replicaCounter >= LABELS.length) {
    throw new Error("Replica limit reached.");
  }

  while (getReplicaIds().includes(LABELS[replicaCounter]!)) replicaCounter++;

  if (replicaCounter >= LABELS.length) {
    throw new Error("Replica limit reached.");
  }

  return LABELS[replicaCounter++]!;
};

const handleEdit = (replicaId: string, replica: Replica) => {
  const oldVal = replica.snapshot;
  const newVal = replica.textArea.value;

  let prefixLen = 0;
  while (prefixLen < oldVal.length && prefixLen < newVal.length && oldVal[prefixLen] === newVal[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldVal.length - prefixLen &&
    suffixLen < newVal.length - prefixLen &&
    oldVal[oldVal.length - 1 - suffixLen] === newVal[newVal.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const start = prefixLen;
  const end = oldVal.length - suffixLen;
  const insertedText = newVal.slice(prefixLen, newVal.length - suffixLen);

  if (end > start) {
    deletes(start, end, replicaId);
  }
  if (insertedText.length > 0) {
    inserts(start, insertedText, replicaId);
  }
};

let lastIdx: number | null = null;
let lastTa: HTMLTextAreaElement | null = null;

const highlightElement = (ta: HTMLTextAreaElement, hl: HTMLDivElement, idx: number) => {
  const s = document.createElement("span");
  s.className = "hl";
  s.textContent = ta.value[idx]!;
  hl.replaceChildren(ta.value.slice(0, idx), s, ta.value.slice(idx + 1));
  hl.scrollTop = ta.scrollTop;
};

const clearHighlight = (hl: HTMLDivElement) => {
  lastIdx = null;
  lastTa = null;
  node.textContent = "";
  hl.textContent = "";
};

const refreshReplicaText = (replicaId: string) => {
  replicas[replicaId]!.textArea.value = readText(replicaId);
};

const refreshAllReplicaText = () => {
  for (const id of Object.keys(replicas)) {
    refreshReplicaText(id);
  }
};

const resetReplicaUI = () => {
  for (const replica of Object.values(replicas)) {
    replica.snapshot = "";
    replica.textArea.value = "";
    replica.highlight.textContent = "";
  }
  node.textContent = "";
};

const createReplicaUI = (id: string) => {
  const wrap = document.createElement("div");

  wrap.className = "editor-wrap";
  wrap.dataset.replicaId = id;

  const textArea = document.createElement("textarea");
  textArea.placeholder = "USER " + id;

  const highlight = document.createElement("div");
  highlight.className = "highlight-layer";

  wrap.append(textArea, highlight);
  areas.insertBefore(wrap, addButton);

  const replica: Replica = { snapshot: "", textArea: textArea, highlight: highlight };

  replicas[id] = replica;

  textArea.addEventListener("beforeinput", () => { replica.snapshot = textArea.value; });
  textArea.addEventListener("input", () => handleEdit(id, replica));

  textArea.addEventListener("mousemove", (e) => {
    const idx = document.caretPositionFromPoint(e.clientX, e.clientY)?.offset ?? null;
    if (idx === null || idx >= textArea.value.length) {
      clearHighlight(highlight);
      return;
    }

    if (idx === lastIdx && textArea === lastTa) return;

    lastIdx = idx;
    lastTa = textArea;

    highlightElement(textArea, highlight, idx);

    const n = getNodeAtIndex(idx, id);

    node.textContent = n ? JSON.stringify(n, null, 2) : "";
  });

  textArea.addEventListener("mouseleave", () => clearHighlight(highlight));
  textArea.addEventListener("scroll", () => { highlight.scrollTop = textArea.scrollTop; });
};

const updateSelects = () => {
  const ids = getReplicaIds();
  const defaultSrc = ids[0] ?? "";
  const defaultTarget = ids[1] ?? defaultSrc;

  for (const sel of [srcSelect, targetSelect]) {
    const current = sel.value;
    sel.innerHTML = "";

    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      sel.append(opt);
    }

    if (ids.includes(current)) {
      sel.value = current;
    }
  }

  //default behaviour
  if (!srcSelect.value) {
    srcSelect.value = defaultSrc;
  }
  if (!targetSelect.value) {
    targetSelect.value = defaultTarget;
  }
};

addButton.addEventListener("click", () => {
  const id = nextId();
  addReplica(id);
  createReplicaUI(id);
  updateSelects();
});

mergePairBtn.addEventListener("click", () => {
  const src = srcSelect.value;
  const target = targetSelect.value;
  if (src === target) return;
  mergeDocs(true, src, target);
  refreshReplicaText(target);
});

syncAllBtn.addEventListener("click", () => {
  syncAllReplicas();
  refreshAllReplicaText();
});

resetAll.addEventListener("click", () => {
  resetAllDocuments();
  resetReplicaUI();
});

createReplicaUI("A");
createReplicaUI("B");

updateSelects();
