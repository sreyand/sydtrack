'use strict';

// Shared by the classifier and renderer; no Electron or filesystem access.
(function (root) {
  const browserNames = Object.freeze([
    'chrome', 'google chrome', 'msedge', 'edge', 'microsoft edge',
    'firefox', 'mozilla firefox', 'brave', 'brave browser', 'opera', 'opera browser',
    'chromium', 'vivaldi', 'waterfox', 'librewolf', 'floorp', 'zen', 'palemoon',
    'pale moon', 'mullvadbrowser', 'mullvad browser', 'tor browser', 'arc', 'safari',
    'duckduckgo', 'browser'
  ]);
  function normalizeAppName(value) {
    return String(value || '').split(/[/\\]/).pop().trim().toLowerCase().replace(/\.exe$/, '');
  }
  function isBrowserName(value, extraNames) {
    const name = normalizeAppName(value);
    return !!name && (browserNames.includes(name) || /(?:^|[\s-])browser$/.test(name) ||
      (Array.isArray(extraNames) && extraNames.some((item) => normalizeAppName(item) === name)));
  }

  // Cache only rule patterns, never titles or searches. A bounded cache also
  // serves the native classifier and Ignore matcher without recompiling each poll.
  const patterns = new Map();
  const compiledLists = new WeakMap();
  function keywordPattern(key) {
    let pattern = patterns.get(key);
    if (!pattern) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pattern = new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'i');
      if (patterns.size >= 4096) patterns.delete(patterns.keys().next().value);
      patterns.set(key, pattern);
    }
    return pattern;
  }

  function compiledList(list, extraNames) {
    if (!Array.isArray(list)) return { entries: [], sources: new Map() };
    const names = (extraNames || []).map(normalizeAppName).join('\u0000');
    const cached = compiledLists.get(list);
    // Profiles normally replace their arrays. The shallow check also catches
    // in-place changes from import/edit callers without stale classifications.
    if (cached && cached.names === names && cached.original.length === list.length &&
        list.every((value, index) => value === cached.original[index])) return cached;
    const entries = list.map(tag => String(tag || '').trim().toLowerCase())
      .filter(key => key && !key.startsWith('site:') && !isBrowserName(key, extraNames))
      .map(key => ({ key, pattern: keywordPattern(key) }))
      .sort((a, b) => b.key.length - a.key.length);
    const compiled = { names, original: list.slice(), entries, sources: new Map() };
    compiledLists.set(list, compiled);
    return compiled;
  }

  function matchesCompiled(text, entry) {
    return entry.key === 'r/' ? subredditMarker.test(text) : entry.pattern.test(text);
  }

  function sourceEntries(compiled, source) {
    const id = source.id + '\u0000' + source.aliases.join('\u0000');
    let entries = compiled.sources.get(id);
    if (!entries) {
      entries = [];
      for (const entry of compiled.entries) {
        const alias = source.aliases.includes(entry.key);
        const canonical = entry.key === source.id;
        const specific = canonical || source.aliases.some(value => value !== 'r/' && exactKeyword(entry.key, value));
        if (alias || specific) entries.push({ ...entry, scope: specific && !alias ? 1 : 0, needsMatch: !alias && !canonical });
      }
      // Only recognized short source identifiers are cached, never page titles.
      if (compiled.sources.size >= 128) compiled.sources.delete(compiled.sources.keys().next().value);
      compiled.sources.set(id, entries);
    }
    return entries;
  }

  function contentTitle(title, extraNames) {
    let text = String(title || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    // Match the shell label only at the end. A page discussing Chrome DevTools
    // keeps its meaningful content; "- Google Chrome" is not page context.
    for (const name of [...(extraNames || []), ...browserNames]) {
      let suffix = shellSuffixes.get(name);
      if (!suffix) {
        const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        suffix = new RegExp('\\s+[-–—|]\\s*' + escaped + '(?:\\s+\\((?:incognito|private browsing|inprivate)\\))?$', 'i');
        if (shellSuffixes.size >= 128) shellSuffixes.delete(shellSuffixes.keys().next().value);
        shellSuffixes.set(name, suffix);
      }
      if (suffix.test(text)) { text = text.replace(suffix, '').trim(); break; }
    }
    return text;
  }
  const shellSuffixes = new Map();

  // These labels identify a source, not its worth. Its category still comes
  // from the user's profile or browser rules. Only explicit title labels count.
  const titleSources = [
    ['youtube', ['youtube', 'youtube shorts']], ['reddit', ['reddit', 'reddit - dive into anything']],
    ['github', ['github']], ['gitlab', ['gitlab']], ['bitbucket', ['bitbucket']],
    ['stack overflow', ['stack overflow']], ['mdn', ['mdn web docs', 'mdn']],
    ['chatgpt', ['chatgpt']], ['claude', ['claude']], ['notion', ['notion']],
    ['google docs', ['google docs']], ['google sheets', ['google sheets']],
    ['google slides', ['google slides']], ['google drive', ['google drive']],
    ['google scholar', ['google scholar']], ['gmail', ['gmail']],
    ['gradescope', ['gradescope']], ['canva', ['canva']], ['figma', ['figma']],
    ['overleaf', ['overleaf']], ['wikipedia', ['wikipedia']],
    ['instagram', ['instagram']], ['facebook', ['facebook']], ['tiktok', ['tiktok']],
    ['twitch', ['twitch']], ['netflix', ['netflix']], ['discord', ['discord']],
    ['slack', ['slack']], ['zoom', ['zoom']], ['medium', ['medium']]
  ];
  const sourcePatterns = titleSources.map(([id, aliases]) => ({
    id, aliases,
    suffixes: aliases.map(alias => new RegExp('(?:^|\\s[-–—|·]\\s*)' +
      alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))
  }));

  const subredditMarker = /(?:^|\s[-–—|]\s*)r\/([a-z0-9_]{1,21})(?=\s*(?:$|[-–—|]\s*reddit\s*$))/i;
  function sourceFromTitle(text) {
    // Search-result titles can discuss any service; they do not identify a visit.
    if (/\s[-–—|]\s*(?:google search|bing|duckduckgo)$/i.test(text)) return null;
    const subreddit = text.match(subredditMarker);
    if (subreddit) return { id: 'r/' + subreddit[1].toLowerCase(), aliases: ['r/', 'reddit'], subreddit: true };
    if (/^(?:home|explore|notifications|messages|search)\s*\/\s*x$/i.test(text)) {
      return { id: 'x.com', aliases: ['x.com', 'twitter', text.toLowerCase()] };
    }
    const suffix = sourcePatterns.find(source => source.suffixes.some(pattern => pattern.test(text)));
    if (suffix) return suffix;
    // GitHub repository titles use a branded prefix plus an owner/repo pair.
    // A mere mention such as "GitHub tutorial" does not qualify as a source.
    if (/^github\s*[-–—|]\s+[a-z0-9_.-]+\/[a-z0-9_.-]+(?=[:\s]|$)/i.test(text)) {
      return { id: 'github', aliases: ['github'] };
    }
    return null;
  }

  function titleSource(title, extraNames) {
    return sourceFromTitle(contentTitle(title, extraNames));
  }

  function bestKeyword(text, rules, extraNames, predicate = () => true) {
    if (!rules) return null;
    for (const category of ['other', 'unproductive', 'productive']) {
      for (const entry of compiledList(rules[category], extraNames).entries) {
        if (predicate(entry.key) && matchesCompiled(text, entry)) return { category, reason: entry.key, source: 'profile keyword' };
      }
    }
    return null;
  }

  function sourceKeyword(text, rules, source, extraNames) {
    let best = null;
    for (const category of ['productive', 'unproductive', 'other']) {
      for (const entry of sourceEntries(compiledList(rules && rules[category], extraNames), source)) {
        if (entry.needsMatch && !matchesCompiled(text, entry)) continue;
        const key = entry.key;
        // A precise subreddit or a phrase containing the source can override its
        // broad marker. Topic words alone cannot. Equal-length scopes keep O > U > P.
        const scope = entry.scope;
        if (!best || scope > best.scope || (scope === best.scope &&
            ((scope === 0 && category !== best.category) || key.length >= best.reason.length))) {
          best = { category, reason: key, source: 'title source', scope };
        }
      }
    }
    return best;
  }

  function quickKeyword(entry, rules) {
    const extraNames = rules && rules.identities && rules.identities.browserApps;
    const text = contentTitle(entry && entry.title, extraNames).toLowerCase();
    const source = sourceFromTitle(text);
    if (source) {
      const specific = sourceKeyword(text, rules, source, extraNames);
      return specific && specific.scope ? specific.reason : source.id;
    }
    // Reuse an explicit matched title rule; never guess the last word of an
    // unfamiliar page or turn a bare search-engine title into a blanket rule.
    return bestKeyword(text, rules, extraNames)?.reason || null;
  }

  function isUnrecognizedReason(reason) {
    return !reason || ['No matching rule', 'No matching keyword', 'Keyword not recorded', 'Browser default'].includes(reason);
  }
  function hostname(value) {
    if (typeof value !== 'string' || !value.trim() || /\s/.test(value)) return '';
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      return host.includes('.') && /^[a-z0-9.-]+$/.test(host) ? host : '';
    } catch (_) { return ''; }
  }

  function siteDomain(tag) {
    if (typeof tag !== 'string' || !/^site:/i.test(tag.trim())) return '';
    const value = tag.trim().slice(5).toLowerCase();
    // Rules are domains, never paths, search terms, credentials, or wildcards.
    if (!/^[a-z0-9.-]+$/.test(value)) return '';
    const host = hostname(value);
    return host && host.split('.').every((part) => part && !part.startsWith('-') && !part.endsWith('-')) ? host : '';
  }

  function siteMatch(url, rules) {
    const host = hostname(url);
    if (!host) return null;
    let best = '', category = null;
    // More specific subdomains win; an explicit Other exception wins ties.
    for (const type of ['productive', 'unproductive', 'other']) {
      for (const tag of (rules && rules[type]) || []) {
        const domain = siteDomain(tag);
        if (domain && (host === domain || host.endsWith(`.${domain}`)) && domain.length >= best.length) {
          best = domain;
          category = type;
        }
      }
    }
    return category ? { category, reason: 'site:' + best } : null;
  }

  function classifySite(url, rules) { return siteMatch(url, rules)?.category || null; }
  function exactKeyword(text, key) {
    return keywordPattern(String(key)).test(String(text || ''));
  }

  // Source-specific profile choices win. Source labels outrank topic words;
  // explicit neutral words still provide exceptions to a broad P/U source.
  function browserMatch(entry, rules) {
    const site = siteMatch(entry && entry.url, rules);
    if (site) return { ...site, source: 'site rule' };
    const extraNames = rules && rules.identities && rules.identities.browserApps;
    const title = contentTitle(entry && entry.title, extraNames);
    const text = `${title} ${(entry && entry.url) || ''}`.toLowerCase();
    const source = sourceFromTitle(title);
    if (source) {
      const explicit = sourceKeyword(text, rules, source, extraNames);
      const neutral = bestKeyword(text, { other: rules && rules.other }, extraNames);
      const fallback = sourceKeyword(text, rules && rules.browserKeywords, source, extraNames);
      const match = explicit && explicit.scope ? explicit : neutral || explicit || fallback;
      if (match) return { category: match.category, reason: source.subreddit ? source.id : match.reason, source: match.source,
        matchedRule: match.reason, ruleOrigin: match === fallback ? 'browser' : 'profile' };
    }
    const profile = bestKeyword(text, rules, extraNames);
    const fallback = bestKeyword(text, rules && rules.browserKeywords, extraNames);
    return profile || (fallback && { ...fallback, source: 'browser keyword' }) ||
      { category: 'other', reason: 'No matching rule', source: 'none' };
  }
  function classifyBrowser(entry, rules) { return browserMatch(entry, rules).category; }

  function validateSiteTags(rules) {
    for (const type of ['productive', 'unproductive', 'other']) {
      for (const tag of (rules && rules[type]) || []) {
        if (typeof tag === 'string' && /^site:/i.test(tag.trim()) && !siteDomain(tag)) {
          throw new Error(`Invalid website tag: ${tag}. Use site:example.com.`);
        }
      }
    }
  }

  const api = { browserMatch, hostname, siteDomain, classifySite, classifyBrowser, validateSiteTags,
    browserNames, isBrowserName, exactKeyword, contentTitle, titleSource, quickKeyword, isUnrecognizedReason };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.sydtrackBrowserRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
