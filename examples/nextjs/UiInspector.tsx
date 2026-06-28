'use client';

/**
 * Click to Source - loads the client script in development only.
 * Lets the VS Code panel detect the source file of any element you click.
 * It is a no-op in production (process.env.NODE_ENV === 'production').
 *
 * HOW TO USE (Next.js App Router or Pages Router):
 * 1. Copy `media/inspector-client.js` from the extension into your project's
 *    `public/` folder  ->  public/inspector-client.js
 * 2. Copy this file into your project, e.g. components/UiInspector.tsx
 * 3. Render it once in your root layout:
 *
 *      // app/layout.tsx
 *      import { UiInspector } from '@/components/UiInspector';
 *      ...
 *      <body>
 *        {children}
 *        <UiInspector />
 *      </body>
 */
import { useEffect } from 'react';

export function UiInspector() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (document.getElementById('click-to-source-script')) return;

    const script = document.createElement('script');
    script.id = 'click-to-source-script';
    script.src = '/inspector-client.js';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  return null;
}

export default UiInspector;
