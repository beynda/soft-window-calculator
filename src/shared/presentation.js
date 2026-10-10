import { russian } from './translations.js';

const DEFAULTS = Object.freeze({ language: 'en', units: 'cm', market: 'RUB' });
let current = DEFAULTS;
export function normalizePresentation(value = {}) {
  const language = value.language === 'ru' ? 'ru' : 'en';
  return Object.freeze({ language, units: language === 'ru' ? 'cm' : value.units === 'in' ? 'in' : 'cm', market: language === 'ru' ? 'RUB' : ['USD', 'EUR', 'RUB'].includes(value.market) ? value.market : 'USD' });
}
export function setPresentation(value) { current = normalizePresentation(value); return current; }
export function getPresentation() { return current; }
export function withPresentation(value, action) {
  const previous = current;
  if (value) current = normalizePresentation(value);
  try { return action(); } finally { current = previous; }
}
export function locale() { return current.language === 'ru' ? 'ru-RU' : 'en-US'; }
export function displayLength(cm) { return current.units === 'in' ? Number(cm) / 2.54 : Number(cm); }
export function canonicalLength(value) { return current.units === 'in' ? Number((Number(value) * 2.54).toFixed(6)) : Number(value); }
export function inputLength(cm) { return Number(displayLength(cm).toFixed(8)); }
export function length(cm) { return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(displayLength(cm))} ${current.units === 'in' ? 'in' : current.language === 'ru' ? 'см' : 'cm'}`; }
export function labels(values) { return new Proxy(values, { get(target, key) { const value = target[key]; return typeof value === 'string' ? t(value) : value; } }); }

const pairs = Object.entries(russian).filter(([key]) => key.length > 0).sort((a, b) => b[0].length - a[0].length);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${pairs.map(([key]) => escapeRegex(key)).join('|')})(?![\\p{L}\\p{N}_-])`, 'gu');
export function t(value) {
  const source = String(value ?? '');
  if (source.includes('<')) return source.split(/(<[^>]*>)/g).map((part) => part.startsWith('<') ? part.replace(/(aria-label|title|placeholder)="([^"]*)"/g, (_, name, text) => `${name}="${translateText(text)}"`) : translateText(part)).join('');
  return translateText(source);
}
function translateText(value) {
  let text = String(value ?? '');
  if (current.units === 'in') {
    text = text.replace(/\b([0-9]+(?:\.[0-9]+)?) cm\b/g, (_, cm) => length(cm));
    text = text.replace(/\bcm\b/g, 'in');
  }
  if (current.language !== 'ru') return text;
  if (Object.hasOwn(russian, text)) return russian[text];
  return text.replace(pattern, (key) => russian[key]).replace(/\bcm\b/g, 'см').replace(/\bm²/g, 'м²').replace(/\bm\b/g, 'м');
}
// Translate static template segments only. User-entered values retain their content.
export function msg(strings, ...values) {
  let output = '';
  for (let index = 0; index < strings.length; index++) {
    let segment = strings[index];
    if (index && /^\s+cm\b/.test(segment)) {
      const value = values[index - 1];
      const formatted = String(value).replace(/[\s\u00a0\u202f]/g, '');
      const numeric = typeof value === 'number' ? value : Number(current.language === 'ru' ? formatted.replace(',', '.') : formatted.replaceAll(',', ''));
      output += length(numeric);
      segment = segment.replace(/^\s+cm\b/, '');
    } else if (index) output += values[index - 1] ?? '';
    output += t(segment);
  }
  return output;
}
export function marketConfig(config, market) {
  if (market === config.currency) return config;
  const rates = config.marketRates?.[market];
  if (!rates) throw new RangeError(`No tariff profile is configured for ${market}.`);
  return { ...config, currency: market, tariffs: rates.tariffs, vat: rates.vat };
}
