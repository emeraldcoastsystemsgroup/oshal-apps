# libreoffice-writer 24.2.7 (package) on linux

## What to Read First

Before making changes in `libreoffice-writer` `24.2.7 (package)` on `linux` through the `libreoffice` bridge, inspect the active session and document state:

1. Call `computer.app` with `"action": "apps"` to verify whether `libreoffice-writer` is running and connected through the `libreoffice` bridge. If the application is not open, launch or open the target with `computer.open`, then confirm presence with `computer.app` and `"action": "apps"`.
2. Call `computer.app` with `"action": "snapshot"` to read the current window tree, document kind, active text content, cursor or selection context, and any open modal dialogs.
3. Confirm from the snapshot that the active document kind is `text` before calling any declared verb for `text`.
4. If no document is open yet, inspect recent items using `computer.app` with `"action": "invoke"` and `"declared": "recent-documents"`, open an existing document with `"action": "invoke"` and `"declared": "open-document"`, or create a blank document with `"action": "invoke"` and `"declared": "new-document"`.

## How Common Tasks Are Done

Prefer the `libreoffice` bridge declared verbs for `text` documents via `computer.app` with `"action": "invoke"` over manual control navigation whenever a declared verb covers the task.

### Creating, Opening, Saving, and Exporting Documents
- List recent documents: call `computer.app` with `"action": "invoke"` and `"declared": "recent-documents"`.
- Create a new text document: call `computer.app` with `"action": "invoke"` and `"declared": "new-document"`.
- Open an existing document: call `computer.app` with `"action": "invoke"` and `"declared": "open-document"`.
- Save the current document: call `computer.app` with `"action": "invoke"` and `"declared": "save-document"`.
- Export the current document (for example to another supported output format): call `computer.app` with `"action": "invoke"` and `"declared": "export-document"`.

### Adding, Editing, and Deleting Text
- Insert a paragraph: call `computer.app` with `"action": "invoke"` and `"declared": "insert-paragraph"`.
- Add a document section: call `computer.app` with `"action": "invoke"` and `"declared": "add-section"`.
- Replace a specific span of text: call `computer.app` with `"action": "invoke"` and `"declared": "replace-text"`.
- Search and replace across the document: call `computer.app` with `"action": "invoke"` and `"declared": "find-replace"`.
- Delete a paragraph: call `computer.app` with `"action": "invoke"` and `"declared": "delete-paragraph"`.

### Formatting Text
- Apply character or paragraph formatting supported by the bridge: call `computer.app` with `"action": "invoke"` and `"declared": "format-text"`.

### Navigating and Interacting with Controls Not Covered by Declared Verbs
When a task requires interacting with visible controls, dialogs, or document regions not handled by a declared verb:
- Read available controls first with `computer.app` and `"action": "snapshot"`.
- Move through long documents or lists with `computer.app` and `"action": "scroll"`.
- Choose an item, paragraph, or control target with `computer.app` and `"action": "select"`.
- Trigger a focused button or menu item with `computer.app` and `"action": "invoke"` or `"action": "press"`.
- Enter text into an active input field with `computer.app` and `"action": "type"`.

### Reverting Mistakes
- To step back a single recent change inside the document, call `computer.app` with `"action": "undo"`.
- To return to a prior captured state when supported by the bridge session, call `computer.app` with `"action": "restore"`.

## What to Check After Each Step

After every action or declared verb call in `computer.app`:

1. Call `computer.app` with `"action": "snapshot"` to inspect the resulting state.
2. After `"declared": "new-document"` or `"declared": "open-document"`, verify that the active document is loaded, the document kind is `text`, and no blocking recovery or lock dialog is present.
3. After `"declared": "insert-paragraph"`, `"declared": "add-section"`, `"declared": "replace-text"`, `"declared": "delete-paragraph"`, or `"declared": "find-replace"`, check the snapshot text content and paragraph ordering to confirm the exact change occurred and neighboring paragraphs were not unintentionally altered.
4. After `"declared": "format-text"`, check the snapshot attributes or style indicators on the target text to confirm the formatting took effect.
5. After `"declared": "save-document"` or `"declared": "export-document"`, check the snapshot for any overwrite prompt, format confirmation dialog, or error alert, and confirm the document modification state reflects a completed save.
6. If a step produces an unexpected change, immediately run `computer.app` with `"action": "undo"` (or `"action": "restore"`) and take a fresh `"action": "snapshot"` before trying again.

## What Is Not Known for This Version

- Exact parameter schemas and return payload fields for each declared verb on the `libreoffice` bridge: Not known for this version.
- Whether this `24.2.7 (package)` build on `linux` defaults to the standard toolbar layout, tabbed User Interface mode, or a distribution-customized layout: Not known for this version.
- Exact control labels, accelerator keys, and dialog widget hierarchies across different `linux` desktop environments (such as GTK or Qt VCL backends) in `24.2.7 (package)`: Not known for this version. Always rely on `computer.app` with `"action": "snapshot"` rather than assuming fixed control names.
- Behaviour of table editing, track-changes review, mail merge, footnote insertion, or page style configuration through declared verbs: Not known for this version, as no declared verbs for those operations are listed.