// Builds the demo copy of the server: the real server, with server/_core/supabase.ts swapped for the
// in-memory fake (scripts/demo/fakeSupabase.ts). Run from the project root: node scripts/demo/build.mjs
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const real = path.join(root, "server", "_core", "supabase.ts");
const fake = path.join(root, "scripts", "demo", "fakeSupabase.ts");

await build({
  entryPoints: ["server/_core/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  // Next to dist/public, which the server serves as the portal's screens.
  outfile: "dist/demo-server.js",
  logLevel: "warning",
  plugins: [{
    name: "fake-supabase",
    setup(b) {
      b.onResolve({ filter: /supabase$/ }, (args) => {
        if (args.path.startsWith("@")) return undefined;
        const resolved = path.resolve(args.resolveDir, `${args.path}.ts`);
        return resolved === real ? { path: fake } : undefined;
      });
    },
  }],
});
console.log("dist/demo-server.js pronto");
