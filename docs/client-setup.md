# Connecting your app

The panel shows your app inside an iframe. For security, a page in an iframe cannot
read its own code from the outside, so the extension relies on a tiny script that
runs **inside your app, in development only**. This page explains how to add it.

You only do this once per project.

---

## React / Next.js

1. Copy [`media/inspector-client.js`](../media/inspector-client.js) into your
   project's `public/` folder:

   ```
   your-app/public/inspector-client.js
   ```

2. Copy [`examples/nextjs/UiInspector.tsx`](../examples/nextjs/UiInspector.tsx) into
   your components folder.

3. Render it once in your root layout:

   ```tsx
   // app/layout.tsx
   import { UiInspector } from '@/components/UiInspector';

   export default function RootLayout({ children }) {
     return (
       <html>
         <body>
           {children}
           <UiInspector />
         </body>
       </html>
     );
   }
   ```

The component does nothing in production, so it is safe to leave in.

---

## Plain HTML, Vue, or a server-rendered app (Flask, Django, PHP, etc.)

Add the script with a normal tag, ideally only in development:

```html
<script src="/inspector-client.js"></script>
```

For plain HTML and templates, the extension finds the element by its `id`, a
distinctive class, or its visible text, and opens the matching source file.

---

## If the panel is blank

That usually means your dev server refuses to be embedded in an iframe. Look for a
response header like `X-Frame-Options: DENY` or a Content-Security-Policy with
`frame-ancestors`, and disable it **in development only**.

For example, in a Next.js `next.config.ts` that sets security headers, wrap the
`X-Frame-Options` entry so it only applies in production:

```ts
...(process.env.NODE_ENV === 'production'
  ? [{ key: 'X-Frame-Options', value: 'DENY' }]
  : []),
```
