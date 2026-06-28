// Bundles the extension into a single out/extension.js file.
//
// Bundling lets us inline the source-map dependency, so the published extension
// is self-contained and does not ship node_modules. That keeps the package small
// and avoids the vsce + pnpm dependency-listing problem.

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const context = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    format: 'cjs',
    platform: 'node',
    target: 'node16',
    // The VS Code API is provided by the host at runtime, never bundled.
    external: ['vscode'],
    sourcemap: !production,
    minify: production,
    logLevel: 'info'
  });

  if (watch) {
    await context.watch();
  } else {
    await context.rebuild();
    await context.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
