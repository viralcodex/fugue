import { deletes, readText, resetAllDocuments, insert, mergeDocs, getNodeAtIndex } from "./crdt";
import type { Replica } from "./types";

const leftTextArea = document.getElementById("leftText") as HTMLTextAreaElement | null;
const rightTextArea = document.getElementById("rightText") as HTMLTextAreaElement | null;
const mergeLeftToRight = document.getElementById("copyLeftToRight") as HTMLButtonElement | null;
const mergeRightToLeft = document.getElementById("copyRightToLeft") as HTMLButtonElement | null;
const resetAll = document.getElementById("resetAll") as HTMLButtonElement | null;

const node = document.getElementById("node") as HTMLDivElement | null;

if (!leftTextArea || !rightTextArea || !mergeLeftToRight || !mergeRightToLeft || !resetAll || !node) {
  throw new Error("Required DOM elements are missing.");
}

resetAll.addEventListener("click", () => {
  resetAllDocuments();
  for (const replica of Object.values(replicas)) {
    replica.textArea.value = "";
    replica.highlight.textContent = "";
  }
  node.textContent = "";
});

const replicas: Record<string, Replica> = {
  "A": {
    snapshot: "",
    textArea: leftTextArea,
    highlight: document.getElementById("hlLeft") as HTMLDivElement,
  },
  "B": {
    snapshot: "",
    highlight: document.getElementById("hlRight") as HTMLDivElement,
    textArea: rightTextArea,
  }
}

mergeLeftToRight.addEventListener("click", () => {
  mergeDocs();
  rightTextArea.value = readText("B");
});

mergeRightToLeft.addEventListener("click", () => {
  mergeDocs(false);
  leftTextArea.value = readText("A");
});

for(const [id, replica] of Object.entries(replicas))
{
  replica.textArea.addEventListener("beforeinput", () => { replica.snapshot = replica.textArea.value });
  replica.textArea.addEventListener("input", () => handleEdit(id, replica));
}


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
    insert(start, insertedText, replicaId);
  }
};

let lastIdx: number | null = null;
let lastTa: HTMLTextAreaElement | null = null;

const highlight = (ta: HTMLTextAreaElement, hl: HTMLDivElement, idx: number) => {
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

for (const [id, replica] of Object.entries(replicas)) {
  const { textArea, highlight: hl } = replica;

  textArea.addEventListener("mousemove", (e) => {
    const idx = document.caretPositionFromPoint(e.clientX, e.clientY)?.offset ?? null;

    if (idx === null || idx >= textArea.value.length) {
      clearHighlight(hl);
      return;
    }

    if (idx === lastIdx && textArea === lastTa) return;

    lastIdx = idx;
    lastTa = textArea;

    highlight(textArea, hl, idx);
    const n = getNodeAtIndex(idx, id);
    node.textContent = n ? JSON.stringify(n, null, 2) : "";
  });

  textArea.addEventListener("mouseleave", () => clearHighlight(hl));
  textArea.addEventListener("scroll", () => { hl.scrollTop = textArea.scrollTop; });
}

