import { describe, it, expect, beforeEach } from "vitest";
import { fileViewer, editorDirty, discardDialogOpen, openFile, dismissViewerForRepo } from "@/lib/file-viewer";

// dismissViewerForRepo exists because a repo can vanish out from under an open viewer: the owner
// removed it, or an all-repos share-link guest watched it leave scope the moment the owner hid it
// (arrives as the store's repo_removed SSE branch either way). There's nothing left to save at that
// point, so unlike closeFile() it must never show the unsaved-edits discard prompt — it just closes.
describe("dismissViewerForRepo", () => {
  beforeEach(() => {
    fileViewer.open = false;
    fileViewer.target = null;
    editorDirty.value = false;
  });

  it("closes the viewer and nulls the target when the open file belongs to the removed repo", async () => {
    await openFile({ repoId: "A", path: "a.txt" });
    dismissViewerForRepo("A");
    expect(fileViewer.open).toBe(false);
    expect(fileViewer.target).toBeNull();
  });

  it("leaves a viewer open on a different repo untouched", async () => {
    await openFile({ repoId: "A", path: "a.txt" });
    dismissViewerForRepo("B");
    expect(fileViewer.open).toBe(true);
    expect(fileViewer.target).toMatchObject({ repoId: "A", path: "a.txt" });
  });

  it("closes without prompting even with unsaved edits — the whole reason it isn't closeFile()", async () => {
    await openFile({ repoId: "A", path: "a.txt" });
    editorDirty.value = true; // set AFTER opening — openFile() itself consults confirmDiscardEdits
    dismissViewerForRepo("A");
    expect(fileViewer.open).toBe(false);
    expect(fileViewer.target).toBeNull();
    expect(editorDirty.value).toBe(false);
    expect(discardDialogOpen.value).toBe(false); // no confirm dialog was ever raised
  });

  it("is a harmless no-op when the viewer is already closed", () => {
    dismissViewerForRepo("A");
    expect(fileViewer.open).toBe(false);
    expect(fileViewer.target).toBeNull();
  });
});
