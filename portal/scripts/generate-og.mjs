import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const iconPath = path.resolve(webRoot, "app/icon.png");
const outPath = path.resolve(webRoot, "public/og.png");

const WIDTH = 1200;
const HEIGHT = 630;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#223129" stroke-width="1" opacity="0.35"/>
    </pattern>
    <radialGradient id="glow" cx="85%" cy="10%" r="60%">
      <stop offset="0%" stop-color="#1c985a" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#1c985a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0b0f0d"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <text x="280" y="190" font-family="Arial, Helvetica, sans-serif" font-size="88" font-weight="700" fill="#e8f2ec" letter-spacing="-3">hyseed</text>
  <text x="282" y="250" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#9fb6aa">An open-source local knowledge base for AI agents</text>
  <rect x="280" y="300" width="520" height="1" fill="#223129"/>
  <text x="280" y="355" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#3ddc8a">Open source · MCP-native · MIT</text>
  <text x="280" y="395" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#6f8579">Local-first · No cloud · No telemetry</text>
  <text x="80" y="560" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#9fb6aa">hyseed.lmlh.net</text>
  <text x="1120" y="560" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#6f8579">Windows x64</text>
</svg>`;

await fs.mkdir(path.dirname(outPath), { recursive: true });

const icon = await sharp(iconPath).resize(160, 160).png().toBuffer();

await sharp(Buffer.from(svg))
  .composite([{ input: icon, top: 80, left: 80 }])
  .png()
  .toFile(outPath);

console.log(`Generated ${path.relative(webRoot, outPath)}`);