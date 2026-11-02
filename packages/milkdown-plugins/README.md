# `@codex-complex-prompt/milkdown-plugins`

Private workspace integrations between Milkdown and React UI for shared replacements, Mermaid diagrams, and media. Import them through the `./shared`, `./mermaid/*`, and `./media/*` entrypoints.

## Get Started

This package is private and is not published to npm. Add it to a consuming workspace app with `workspace:*`. The app must provide the peer dependencies, including the Mermaid SDK so it can compose its own editor UI.

```json
{
  "dependencies": {
    "@codex-complex-prompt/milkdown-plugins": "workspace:*",
    "@mermaid-editor-sdk/ui": "^0.2.0",
    "@milkdown/crepe": "^7.22.1",
    "@milkdown/kit": "^7.22.1",
    "lucide-react": "^1.53.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  }
}
```

The app owns lazy loading and imports `@mermaid-editor-sdk/ui/style.css` with the Mermaid UI components.

## Architecture

| Entry point                                           | Provides                                                | Requirements                                                            |
| ----------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `@codex-complex-prompt/milkdown-plugins/shared`       | Shared replacement metadata                             | None                                                                    |
| `@codex-complex-prompt/milkdown-plugins/mermaid/core` | Preview helpers, error boundary, and Milkdown commands  | `@milkdown/crepe`, `@milkdown/kit`, React, and browser DOM              |
| `@codex-complex-prompt/milkdown-plugins/mermaid/ui`   | Mermaid React components                                | React, React DOM, `lucide-react`, `@mermaid-editor-sdk/ui`, browser DOM |
| `@codex-complex-prompt/milkdown-plugins/media/core`   | MIME detection from data URLs and HTTP response headers | Browser Fetch API                                                       |
| `@codex-complex-prompt/milkdown-plugins/media/ui`     | Image and video React renderer                          | React and browser DOM                                                   |

`MediaRenderer` receives a Markdown image destination, its resolved MIME type, and `alt` text. Use `resolveMediaMimeType` to read the MIME type embedded in a `data:` URL or the `Content-Type` returned by an HTTP `HEAD` request. Cross-origin media servers must support `HEAD` and allow the app origin through CORS; otherwise MIME resolution fails and the host displays “Media unavailable.” The host resolves authenticated attachment URLs and provides `renderEmpty` and `renderError` UI. Supported video types are MP4, QuickTime, and WebM; other non-image paths go through the error callback.

### Shared

#### How to use

Use `MERMAID_UI_REPLACEMENT_MODEL` for the Mermaid code-block language and replacement marker:

```ts
import { MERMAID_UI_REPLACEMENT_MODEL } from '@codex-complex-prompt/milkdown-plugins/shared';

const isMermaid = language === MERMAID_UI_REPLACEMENT_MODEL.language;
const marker = MERMAID_UI_REPLACEMENT_MODEL.kind;
```

### Mermaid Diagram

The consuming app connects Mermaid preview targets and UI to its Milkdown instance.

#### How to use

Pass one `{ language, source, position }` record for every code block and every `.milkdown-code-block` element in the same document order. Include non-Mermaid code blocks in both lists; the helper pairs them by index and creates mounts for Mermaid blocks.

```tsx
import { useState } from 'react';
import {
  createMermaidPreviewTargets,
  replaceMermaidBlock,
} from '@codex-complex-prompt/milkdown-plugins/mermaid/core';
import type { MermaidDiagramTarget } from '@codex-complex-prompt/milkdown-plugins/mermaid/core';
import {
  MermaidDiagramCard,
  MermaidDiagramDialog,
} from '@codex-complex-prompt/milkdown-plugins/mermaid/ui';

// Inside the consuming editor component, which provides the values below.
const [editingTarget, setEditingTarget] = useState<MermaidDiagramTarget | null>(null);
const targets = createMermaidPreviewTargets(contents, blockElements);
return (
  <>
    {targets.map((target) => (
      <MermaidDiagramCard
        key={target.id}
        target={target}
        readOnly={readOnly}
        onEdit={setEditingTarget}
        onReplace={(target, source) => replaceMermaidBlock(crepe, target, source)}
      />
    ))}
    {editingTarget !== null && (
      <MermaidDiagramDialog
        Editor={MermaidDiagramEditor}
        target={editingTarget}
        onClose={() => setEditingTarget(null)}
        onReplace={(target, source) => replaceMermaidBlock(crepe, target, source)}
      />
    )}
  </>
);
```

The consuming component supplies `contents`, `blockElements`, `crepe`, `readOnly`, and `MermaidDiagramEditor`. `replaceMermaidBlock` returns `false` for stale targets; omit `source` to remove a block. `insertMermaidDiagram(crepe)` inserts an empty Mermaid block at the selection.

`hasMermaidRelevantMutations` and `hasRemovedMermaidPreviewCard` help mutation observers decide when to resync previews. `MermaidPreviewErrorBoundary` provides a fallback for rendering errors and resets when its `resetKey` changes.

#### Can I customize?

Pass a component to `MermaidDiagramDialog`'s required `Editor` prop. It receives `source`, `view` (`canvas` or `code`), `onChange`, and `onSave`; the dialog manages its modal and save flow.

For SDK UI composition and component APIs, see the [official UI package documentation](https://mermaid-editor-sdk.vercel.app/docs).
