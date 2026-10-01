'use strict';

// Live, ephemeral metadata only. Activity grouping reasons and stored history
// deliberately remain unchanged, even when a source group differs from its rule.
(function (root) {
  function createExplanation({ activity, category, correction, correctionDate, ignored, rules = {} }) {
    if (!activity) return null;
    const result = { category };
    if (correction && (!ignored || correction === 'ignored')) return { ...result, kind: 'today', correctionDate };
    if (ignored) return { ...result, kind: 'ignore' };
    if (activity.source === 'none') return { ...result, kind: 'none' };
    if (activity.source === 'app identity' && activity.reason === 'App identity') {
      return { ...result, kind: 'app' };
    }
    return { ...result, kind: 'rule', rule: activity.matchedRule || activity.reason,
      origin: activity.ruleOrigin === 'browser' || activity.source === 'browser keyword' ? 'browser' : 'profile',
      profileId: rules.profileId || rules.id,
      profileName: rules.profileName || rules.name };
  }

  function localDay() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  function formatExplanation(info, { demo = false, today = localDay() } = {}) {
    if (!info) return '';
    const category = { productive: 'Productive', unproductive: 'Unproductive', other: 'Other', ignored: 'Ignored' }[info.category];
    if (!category) return '';
    let text;
    if (info.kind === 'today') {
      const day = typeof info.correctionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(info.correctionDate) && info.correctionDate !== today
        ? info.correctionDate : 'today';
      text = 'Changed to ' + category + ' for ' + day + ' only. Future profile rules are unchanged.';
      if (info.category === 'ignored') text += ' No time is recorded.';
    } else if (info.kind === 'ignore') {
      text = 'This app is on the Ignore list. No time is recorded.';
    } else if (info.kind === 'none') {
      text = 'No matching rule. Kept as Other.';
    } else if (info.kind === 'app') {
      text = 'The app rule marks this app as ' + category + '.';
    } else if (info.kind === 'rule' && typeof info.rule === 'string' && info.rule) {
      const name = info.profileId === 'default' && info.profileName === 'Default' ? 'default' : info.profileName;
      const scope = info.origin === 'browser' ? ' in Browser keywords' :
        typeof name === 'string' && name ? ' in the ' + name + ' profile' : '';
      text = 'Matched “' + info.rule + '”' + scope + '.';
    } else return '';
    return demo ? 'Demo activity. ' + text : text;
  }

  const api = { createExplanation, formatExplanation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.sydtrackClassificationExplanation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
