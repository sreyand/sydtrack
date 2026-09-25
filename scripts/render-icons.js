'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const source = process.argv[2];
const outputDir = process.argv[3];
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

if (!source || !outputDir) {
  console.error('Usage: electron scripts/render-icons.js <source.svg> <output-directory>');
  app.exit(1);
}

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(source, 'utf8');
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    useContentSize: true,
    show: false,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true
    }
  });
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}' +
    'svg{display:block;width:100%;height:100%}' +
    '</style></head><body>' + svg + '</body></html>';
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const image = await win.webContents.capturePage();
  fs.mkdirSync(outputDir, { recursive: true });
  for (const size of sizes) {
    const resized = size === 1024 ? image : image.resize({ width: size, height: size, quality: 'best' });
    fs.writeFileSync(path.join(outputDir, size + '.png'), resized.toPNG());
  }
  win.destroy();
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
