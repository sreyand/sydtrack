'use strict';

// Small renderer-only diff for internally escaped chart/score markup. This is
// not an HTML sanitizer or a general form renderer. Listeners stay on reused
// nodes; only newly required or structurally incompatible subtrees are cloned.
(function (root) {
  function patchChildren(target, markup, options) {
    if (!target || target.nodeType !== 1 || !target.ownerDocument) return false;
    if (typeof markup !== 'string') throw new TypeError('DOM patch markup must be a string.');
    if (target.innerHTML === markup) return false;
    const document = target.ownerDocument;
    const template = document.createElement('template');
    template.innerHTML = markup;
    const key = options && typeof options.key === 'string' && options.key ? options.key : null;
    const focused = target.contains(document.activeElement) ? document.activeElement : null;
    let changed = false;

    const nodeKey = node => key && node.nodeType === 1 ? node.getAttribute(key) : null;
    const compatible = (oldNode, nextNode) => oldNode.nodeType === nextNode.nodeType &&
      (oldNode.nodeType !== 1 || (oldNode.localName === nextNode.localName && oldNode.namespaceURI === nextNode.namespaceURI));
    function keyCounts(nodes) {
      const counts = new Map();
      for (const node of nodes) {
        const value = nodeKey(node);
        if (value !== null) counts.set(value, (counts.get(value) || 0) + 1);
      }
      return counts;
    }
    function patchNode(oldNode, nextNode) {
      if (oldNode.nodeType === 3 || oldNode.nodeType === 8) {
        if (oldNode.nodeValue !== nextNode.nodeValue) {
          oldNode.nodeValue = nextNode.nodeValue;
          changed = true;
        }
        return;
      }
      if (oldNode.nodeType !== 1) return;
      // These targets contain no forms. Defensively leave an actively edited
      // control entirely alone, including option/text children and defaults.
      if (oldNode === focused && /^(input|select|textarea)$/.test(oldNode.localName)) return;
      for (const attribute of [...oldNode.attributes]) {
        if (!nextNode.hasAttribute(attribute.name)) {
          oldNode.removeAttribute(attribute.name);
          changed = true;
        }
      }
      for (const attribute of [...nextNode.attributes]) {
        if (oldNode.getAttribute(attribute.name) !== attribute.value) {
          oldNode.setAttribute(attribute.name, attribute.value);
          changed = true;
        }
      }
      patchList(oldNode, nextNode);
    }
    function patchList(parent, nextParent) {
      const oldNodes = [...parent.childNodes];
      const nextNodes = [...nextParent.childNodes];
      const oldCounts = keyCounts(oldNodes);
      const nextCounts = keyCounts(nextNodes);
      const keyed = new Map(oldNodes.filter(node => {
        const value = nodeKey(node);
        return value !== null && oldCounts.get(value) === 1;
      }).map(node => [nodeKey(node), node]));
      const used = new Set();
      for (let index = 0; index < nextNodes.length; index++) {
        const nextNode = nextNodes[index];
        const value = nodeKey(nextNode);
        let oldNode = null;
        if (value !== null && nextCounts.get(value) === 1) oldNode = keyed.get(value) || null;
        else if (value === null) {
          const current = parent.childNodes[index];
          if (current && !used.has(current) && nodeKey(current) === null && compatible(current, nextNode)) oldNode = current;
          else oldNode = oldNodes.find(node => !used.has(node) && nodeKey(node) === null && compatible(node, nextNode)) || null;
        }
        if (oldNode && (!compatible(oldNode, nextNode) || used.has(oldNode))) oldNode = null;
        if (!oldNode) {
          oldNode = nextNode.cloneNode(true);
          parent.insertBefore(oldNode, parent.childNodes[index] || null);
          changed = true;
        } else {
          if (parent.childNodes[index] !== oldNode) {
            parent.insertBefore(oldNode, parent.childNodes[index] || null);
            changed = true;
          }
          patchNode(oldNode, nextNode);
        }
        used.add(oldNode);
      }
      for (const node of oldNodes) {
        if (!used.has(node) && node.parentNode === parent) {
          parent.removeChild(node);
          changed = true;
        }
      }
    }
    patchList(target, template.content);
    // Older Chromium loses focus when insertBefore moves an existing button.
    // Restore only the exact surviving node, never a replacement or deleted day.
    if (focused && focused.isConnected && target.contains(focused) && document.activeElement !== focused &&
      typeof focused.focus === 'function') focused.focus({ preventScroll: true });
    return changed;
  }

  const api = { patchChildren };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.sydtrackDOM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
