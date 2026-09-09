// Original geometric artwork for fictional films. No external assets or fonts.
// Run from any directory: node scripts/generate-demo-posters.mjs
import { mkdir, writeFile } from "node:fs/promises";

const posters = [
  ["Signal at Dawn", "#112637", "#e6b575", "#77bab5"],
  ["The Glass Tide", "#122c38", "#78dad3", "#5786ac"],
  ["Orbit of Ash", "#261e31", "#efaa80", "#a288c8"],
  ["A Quiet Latitude", "#183233", "#eee3b6", "#79a295"],
  ["Velvet Meridian", "#321c32", "#e69caa", "#9b719e"],
  ["The Last Lighthouse", "#142936", "#f3d0a0", "#779aac"],
  ["Copper Skies", "#372b27", "#e9b471", "#aa735e"],
  ["After the Rain", "#1b302d", "#d9d59a", "#79a79b"],
  ["Paper Satellites", "#2b2439", "#d6c5a1", "#9888b8"],
  ["The Blue Archive", "#122b43", "#80c6de", "#577b9c"],
  ["Between Two Suns", "#39232d", "#ffc080", "#bc7e7b"],
  ["Winter Frequency", "#203344", "#d0e4db", "#7f9db6"],
  ["The Long Return", "#233329", "#d8bc8d", "#8d9b6d"],
  ["Echoes in Amber", "#3b2821", "#efc280", "#b9845e"],
  ["Tidepool City", "#172b3a", "#90c9cb", "#ca9b86"],
  ["Aster Station", "#21253b", "#b0b6e9", "#9084ba"],
];
const output = new URL("../public/assets/demo-posters/", import.meta.url);
await mkdir(output, { recursive: true });
for (const [i, [title, dark, light, mid]] of posters.entries()) {
  const motif = i % 8;
  const stars = Array.from({ length: 42 }, (_, s) => `<circle cx="${(s * 73 + i * 17) % 360}" cy="${(s * 47 + i * 13) % 360}" r="${s % 3 ? .7 : 1.3}" fill="${light}" opacity=".45"/>`).join("");
  const ridges = Array.from({ length: 7 }, (_, r) => `<path d="M-20 ${300 + r * 22} Q70 ${215 + r * 30} 170 ${270 + r * 21} T390 ${230 + r * 28} V540 H-20Z" fill="${r % 2 ? dark : mid}" opacity="${.18 + r * .08}"/>`).join("");
  const waves = Array.from({ length: 18 }, (_, w) => `<path d="M-30 ${260 + w * 9} Q70 ${220 + w * 11} 180 ${265 + w * 9} T390 ${255 + w * 9}" fill="none" stroke="${light}" stroke-width="${w % 3 ? 1 : 2}" opacity="${.13 + w * .017}"/>`).join("");
  const city = Array.from({ length: 17 }, (_, b) => {
    const height = 35 + b * 43 % 120;
    return `<rect x="${b * 23 - 12}" y="${360 - height}" width="18" height="${height}" fill="${dark}"/><path d="M${b * 23 - 6} ${365 - height}v${height - 15}" stroke="${light}" stroke-width="2" stroke-dasharray="3 9" opacity=".6"/>`;
  }).join("");
  const art = [
    `<circle cx="180" cy="190" r="76" fill="url(#sun)"/>${ridges}<path d="M174 352l6-168 6 168M154 252h52M162 225h36" fill="none" stroke="${light}" stroke-width="3"/>`,
    `<circle cx="180" cy="195" r="89" fill="${light}" opacity=".13"/><path d="M180 102L255 247 180 350 105 247Z" fill="${light}" opacity=".3"/><path d="M180 102v248M105 247h150" stroke="${light}" opacity=".8"/>${waves}`,
    `<circle cx="180" cy="220" r="87" fill="url(#sun)"/><g transform="rotate(-29 180 220)"><ellipse cx="180" cy="220" rx="151" ry="43" fill="none" stroke="${light}" stroke-width="3"/><ellipse cx="180" cy="220" rx="162" ry="48" fill="none" stroke="${mid}" stroke-width="12" opacity=".6"/></g>${ridges}`,
    `<circle cx="260" cy="152" r="39" fill="${light}" opacity=".85"/>${ridges}<path d="M180 460L195 320 166 279 180 245" fill="none" stroke="${light}" stroke-width="5" opacity=".7"/>`,
    `<g fill="none" stroke="${light}">${Array.from({ length: 9 }, (_, a) => `<path d="M${40 + a * 13} 390V${170 + a * 4}a${140 - a * 13} ${140 - a * 13} 0 0 1 ${280 - a * 26} 0v220" opacity="${.1 + a * .08}" stroke-width="2"/>`).join("")}</g><circle cx="180" cy="218" r="38" fill="url(#sun)"/>`,
    `<path d="M180 185L-50 85V315Z" fill="${light}" opacity=".1"/><path d="M180 185L410 105V270Z" fill="${light}" opacity=".16"/>${waves}<path d="M153 362l16-179h22l16 179Z" fill="${light}" opacity=".8"/><rect x="166" y="170" width="28" height="24" fill="${dark}" stroke="${light}"/><path d="M160 170l20-19 20 19" fill="${light}"/>`,
    `<circle cx="128" cy="176" r="62" fill="url(#sun)"/><circle cx="244" cy="222" r="41" fill="${light}" opacity=".52"/>${city}${waves}`,
    `${Array.from({ length: 34 }, (_, r) => `<path d="M${r * 13 - 60} 70l-80 300" stroke="${light}" stroke-width="1" opacity=".18"/>`).join("")}<circle cx="180" cy="252" r="83" fill="${mid}" opacity=".6"/><path d="M98 250q82-100 164 0H98M180 250v90q0 20 20 12" fill="${dark}" stroke="${light}" stroke-width="3"/>${waves}`,
  ][motif];
  const words = title.toUpperCase().split(" ");
  const split = Math.ceil(words.length / 2);
  const lines = [words.slice(0, split).join(" "), words.slice(split).join(" ")];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="540" viewBox="0 0 360 540">
<title>${title}</title><desc>Original fictional film artwork for the Hrafnholt synthetic showcase. Apache-2.0.</desc>
<defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="${dark}"/><stop offset=".65" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient><radialGradient id="sun"><stop stop-color="${light}"/><stop offset="1" stop-color="${mid}"/></radialGradient><linearGradient id="shade" x2="0" y2="1"><stop stop-color="${dark}" stop-opacity="0"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
<rect width="360" height="540" fill="url(#bg)"/>${stars}${art}<rect y="340" width="360" height="200" fill="url(#shade)"/>
<rect x="17" y="17" width="326" height="506" fill="none" stroke="${light}" opacity=".25"/>
<text x="180" y="48" text-anchor="middle" fill="${light}" font-family="sans-serif" font-size="8" letter-spacing="4">A FICTIONAL FILM</text>
${lines.map((line, n) => `<text x="180" y="${401 + n * 31}" text-anchor="middle" fill="${light}" font-family="sans-serif" font-size="26" font-weight="700" letter-spacing="2">${line}</text>`).join("")}
<path d="M150 459h60" stroke="${light}" opacity=".6"/><text x="180" y="480" text-anchor="middle" fill="${light}" font-family="sans-serif" font-size="8" letter-spacing="3">HRAFNHOLT · DEMO ${String(i + 1).padStart(2, "0")}</text>
</svg>\n`;
  await writeFile(new URL(`${i + 1}.svg`, output), svg);
}
console.log(`Generated ${posters.length} original fictional posters.`);
