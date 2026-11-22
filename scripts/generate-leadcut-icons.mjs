import { chromium } from '@playwright/test';
import fs from 'node:fs';

const browser = await chromium.launch({headless: true});
const page = await browser.newPage({deviceScaleFactor: 1});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#1858e8"/><path d="M80 256h38l26-74 40 153 43-226 44 286 43-185 33 93 25-47h60" fill="none" stroke="white" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
fs.writeFileSync('public/app-icons/leadcut.svg', svg);
const frames = [];
try {
  for (const size of [16,32,64,128,256,512]) {
    await page.setViewportSize({width:size, height:size});
    await page.setContent(`<style>body{margin:0}svg{width:100vw;height:100vh}</style>${svg}`);
    const png = await page.screenshot({omitBackground:true});
    fs.writeFileSync(`public/app-icons/leadcut-${size}.png`, png);
    if (size <= 256) frames.push({size, png});
  }
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({size,png}, index) => {
    const at = 6 + 16*index;
    header[at] = header[at+1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at+4); header.writeUInt16LE(32, at+6);
    header.writeUInt32LE(png.length, at+8); header.writeUInt32LE(offset, at+12);
    offset += png.length;
  });
  fs.writeFileSync('public/app-icons/leadcut.ico', Buffer.concat([header,...frames.map(frame => frame.png)]));
} finally { await browser.close(); }
console.log('LeadCut icons generated');
