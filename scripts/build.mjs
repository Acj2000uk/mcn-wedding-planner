import { rm, mkdir, cp, copyFile } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
await cp("public", "dist", { recursive: true });
await copyFile("index.html", "dist/index.html");
console.log(
  "Built static app. Netlify packages the authenticated API separately.",
);
