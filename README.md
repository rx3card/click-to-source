# Click to Source

Preview your running app inside VS Code, click any element, and jump straight to the
code that renders it. No switching to the browser, no hunting through files.

It was built for **React / Next.js**, and it also does its best with **plain HTML/CSS**
and **server-rendered templates** (Flask, Django, PHP, EJS, Handlebars, and more). If
you can open it on a local dev server, you can inspect it.

> Add a screenshot or short GIF here once you have one - see `assets/screenshots/`.

---

## What it does

1. You open a panel that embeds your dev server (for example `http://localhost:3000`).
2. You turn on the selector and hover over the page. Elements light up with the name
   of the component that renders them.
3. You click one, and VS Code opens the source file at the exact line.

---

## How it figures out the source

A clicked element doesn't carry a "this came from line 42" label, so the extension
tries several strategies, from most to least precise, and uses the first that lands on
your own code:

1. **Explicit source attributes** - if you use a plugin that stamps `data-inspector-*`
   or `data-source` onto elements, those are used directly.
2. **React / Next (development)** - it reads React's debug stacks and translates the
   compiled position back to your `.tsx`/`.jsx` through the bundler's source maps.
3. **Vue** - the single-file component a node belongs to.
4. **DOM fingerprint** - for plain HTML and templates, it finds the element in your
   source by `id`, a distinctive class, or its visible text.

If none of them can pinpoint the element, it doesn't fail silently: it offers to run a
workspace search instead.

A fair warning on accuracy: React/Next is exact. Plain HTML and templates use a
best-match approach that is usually right but not guaranteed for every element.

---

## Getting started

This project prefers **pnpm** - it is faster and lighter on disk. If you'd like, install
it once from [pnpm.io](https://pnpm.io/installation). Prefer not to? No problem: every
command below also works with **npm**, just swap `pnpm` for `npm`.

### Try it from source

```bash
pnpm install
pnpm run compile
```

Press **F5** to launch the Extension Development Host, then run **Click to Source:
Open Panel** from the Command Palette (`Ctrl+Shift+P`). Set your dev server URL in the
panel's top bar if it isn't `http://localhost:3000`.

### Install it for everyday use

```bash
pnpm add -g @vscode/vsce
vsce package
```

Then **Extensions panel -> ... menu -> Install from VSIX** and pick the generated
`.vsix`.

### Connect your app

The panel needs a small script running inside your app in development. See
[docs/client-setup.md](docs/client-setup.md) for the one-time setup (React, Vue, plain
HTML, and server-rendered apps).

---

## Publishing

To put the code on GitHub and the extension on the Marketplace, follow
[docs/PUBLISHING.md](docs/PUBLISHING.md). It covers both, step by step.

---

## Project structure

```
click-to-source/
├── assets/
│   ├── icon.png              Extension icon (Marketplace and panel tab)
│   └── screenshots/          Images for the README and Marketplace listing
├── docs/
│   ├── client-setup.md       How to wire the client into your app
│   └── PUBLISHING.md         How to ship to GitHub and the Marketplace
├── examples/
│   └── nextjs/
│       └── UiInspector.tsx   Loads the client in a Next.js app (dev only)
├── media/
│   ├── inspector-client.js   Runs inside your app: highlights and detects source
│   └── webview.js            Bridges the app iframe and the extension
├── src/
│   ├── extension.ts          Activation and wiring
│   ├── webviewContent.ts     The panel's HTML
│   ├── sourceResolver.ts     Turns a clicked element into a source location
│   ├── editor.ts             Opens files and the search fallback
│   └── types.ts              Shared types
├── .github/workflows/ci.yml  Builds on every push and pull request
├── esbuild.js                Bundles src into a single out/extension.js
├── CHANGELOG.md
├── LICENSE
├── package.json
└── tsconfig.json
```

---

## Requirements

- A web app served on a local dev server.
- For React/Next, the app running in development (production builds strip the debug
  information the extension relies on).
- A dev server that allows being embedded in an iframe (no `X-Frame-Options: DENY` in
  development).

---

## Contributing

Contributions are very welcome. This is an open project and it gets better with more
eyes on it.

- **Found a bug?** Please don't hesitate to open an issue and tell us about it. Include
  what you did, what you expected, and what happened instead. We'll do our best to look
  into it and get it fixed. Open one here:
  [github.com/rx3card/click-to-source/issues](https://github.com/rx3card/click-to-source/issues)
- **Have an idea or an improvement?** Open an issue to discuss it, or send a pull
  request directly.

No contribution is too small. Even reporting a typo helps.

### Running it locally

```bash
pnpm install
pnpm run compile
```

Press **F5** in VS Code to launch a second window (the Extension Development Host) with
the extension loaded, then run **Click to Source: Open Panel** to try it. While you
work, `pnpm run watch` recompiles on every save.

### Where things live

- `src/` - the extension, split by responsibility: `extension.ts` (wiring),
  `webviewContent.ts` (the panel HTML), `sourceResolver.ts` (turning a clicked element
  into a source location), `editor.ts` (opening files), `types.ts` (shared types).
- `media/` - scripts that run in the browser (the panel bridge and the in-app client).
- `examples/` - sample integration code.
- `docs/` - setup and publishing guides.

A couple of small house rules: keep changes focused and make sure `pnpm run compile`
passes, and no emojis in code, UI strings, or docs.

---

## License

[MIT License](LICENSE).
