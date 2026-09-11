/**
 * Build the demo as one self-contained HTML file.
 *
 * `bun build` inlines the bundled script, the Tailwind CSS and the favicon
 * into `dist-demo/index.html`, so the result can be served from any static
 * host, including a GitHub Pages project path, with no asset paths to break.
 *
 *   bun run --cwd demo build
 */
import tailwind from 'bun-plugin-tailwind';

const result = await Bun.build({
  entrypoints: ['./index.html'],
  outdir: '../dist-demo',
  target: 'browser',
  compile: true,
  minify: true,
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const output of result.outputs) {
  console.log(`${output.path} ${(output.size / 1024).toFixed(0)} KB`);
}
