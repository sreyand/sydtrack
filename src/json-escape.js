'use strict';

// Must match SydTrackWin.EscapeJson in scripts/get-foreground.ps1.
function escapeJsonString(value) {
  let out = '';
  const text = value == null ? '' : String(value);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (text[i] === '\\') out += '\\\\';
    else if (text[i] === '"') out += '\\"';
    else if (code < 32) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += text[i];
  }
  return out;
}

module.exports = { escapeJsonString };
