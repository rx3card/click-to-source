# Contributing

Thanks for taking a look. This is a small project, so the workflow is light.

## Getting set up

```bash
npm install
npm run compile
```

Press **F5** in VS Code to launch a second window (the Extension Development Host)
with the extension loaded. Run **Click to Source: Open Panel** from the Command
Palette to try it.

While working, `npm run watch` recompiles on every save.

## Project layout

- `src/` - the extension, split by responsibility:
  - `extension.ts` - activation and wiring.
  - `webviewContent.ts` - the panel's HTML.
  - `sourceResolver.ts` - turning a clicked element into a source location.
  - `editor.ts` - opening files and the search fallback.
  - `types.ts` - shared types.
- `media/` - scripts that run in the browser (the panel bridge and the in-app client).
- `examples/` - sample integration code.
- `docs/` - setup and publishing guides.
- `assets/` - the icon and screenshots.

## Pull requests

- Keep changes focused and describe what they do.
- Make sure `npm run compile` passes.
- No emojis in code, UI strings, or docs.
