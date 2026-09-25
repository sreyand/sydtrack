'use strict';

const fs = require('fs');
const path = require('path');

const APP_SCHEME = 'sydtrack';
const APP_PAGE_URL = 'sydtrack://app/renderer/index.html';
const WINDOW_BACKGROUND_DARK = '#121418';
const WINDOW_BACKGROUND_LIGHT = '#f3f4f6';

function windowBackgroundColor(shouldUseDarkColors) {
  return shouldUseDarkColors ? WINDOW_BACKGROUND_DARK : WINDOW_BACKGROUND_LIGHT;
}

// Inline style attributes are set by the renderer (tooltips, layout). No remote
// origins, no unsafe-eval. img-src data: keeps the local SVG mask in styles.css.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'"
].join('; ');

function registerAppScheme(protocolApi) {
  protocolApi.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true
      }
    }
  ]);
}

function hardenedWebPreferences(preloadPath) {
  if (typeof preloadPath !== 'string' || !path.isAbsolute(preloadPath)) {
    throw new Error('Preload path must be absolute');
  }
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false
  };
}

function buildBrowserWindowOptions({ preloadPath, iconPath, platform, backgroundColor }) {
  const options = {
    width: 1040,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    title: 'sydtrack',
    backgroundColor: backgroundColor || windowBackgroundColor(true),
    autoHideMenuBar: true,
    show: false,
    webPreferences: hardenedWebPreferences(preloadPath)
  };
  if ((platform === 'win32' || platform === 'linux') && iconPath) {
    options.icon = iconPath;
  }
  return options;
}

function isAllowedNavigation(url) {
  if (typeof url !== 'string' || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== 'app') return false;
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return false;
  return parsed.pathname === '/renderer/index.html';
}

function installNavigationGuards(webContents) {
  const block = (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  };
  webContents.on('will-navigate', block);
  webContents.on('will-redirect', block);
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function applyContentSecurityPolicy(electronSession) {
  electronSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    responseHeaders['Content-Security-Policy'] = [CONTENT_SECURITY_POLICY];
    callback({ responseHeaders });
  });
}

function denyPermissionRequests(electronSession) {
  electronSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
}

function assertIpcSender(event, webContents) {
  if (!webContents || !event || event.sender !== webContents) {
    throw new Error('Rejected IPC from an untrusted sender');
  }
  const frame = event.senderFrame;
  if (!frame) return;
  if (webContents.mainFrame && frame !== webContents.mainFrame) {
    throw new Error('Rejected IPC from a subframe');
  }
  if (typeof frame.url === 'string' && frame.url && !isAllowedNavigation(frame.url)) {
    throw new Error('Rejected IPC from an unexpected origin');
  }
}

function lexicalInside(root, full) {
  const rel = path.relative(root, full);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isServableRelative(portable) {
  return portable === 'src/browser-rules.js' || portable.startsWith('renderer/');
}

function resolveAppFile(requestUrl, appRoot) {
  if (typeof requestUrl !== 'string' || typeof appRoot !== 'string' || !appRoot) return null;
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== 'app') return null;
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch (_) {
    return null;
  }
  if (pathname.includes('\\') || pathname.includes('\0')) return null;
  const parts = pathname.split('/');
  if (parts.some((part) => part === '.' || part === '..')) return null;
  const relativeParts = parts.filter(Boolean);
  if (!relativeParts.length) return null;
  const root = path.resolve(appRoot);
  const full = path.resolve(root, ...relativeParts);
  if (!lexicalInside(root, full)) return null;
  const portable = path.relative(root, full).split(path.sep).join('/');
  if (!isServableRelative(portable)) return null;

  const insideAsar =
    root.endsWith(`${path.sep}app.asar`) || root.includes(`${path.sep}app.asar${path.sep}`);
  if (insideAsar) {
    try {
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    } catch (_) {
      return null;
    }
    return full;
  }

  let realRoot;
  let realFull;
  try {
    realRoot = fs.realpathSync(root);
    realFull = fs.realpathSync(full);
  } catch (_) {
    return null;
  }
  if (!lexicalInside(realRoot, realFull)) return null;
  try {
    if (!fs.statSync(realFull).isFile()) return null;
  } catch (_) {
    return null;
  }
  const realPortable = path.relative(realRoot, realFull).split(path.sep).join('/');
  if (!isServableRelative(realPortable)) return null;
  return realFull;
}

module.exports = {
  APP_SCHEME,
  APP_PAGE_URL,
  WINDOW_BACKGROUND_DARK,
  WINDOW_BACKGROUND_LIGHT,
  windowBackgroundColor,
  CONTENT_SECURITY_POLICY,
  registerAppScheme,
  hardenedWebPreferences,
  buildBrowserWindowOptions,
  isAllowedNavigation,
  installNavigationGuards,
  applyContentSecurityPolicy,
  denyPermissionRequests,
  assertIpcSender,
  resolveAppFile
};
