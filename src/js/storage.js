// Regras de dados e persistência (localStorage, chave "utilit_data").
// Funções de dados são puras: recebem o estado e devolvem um novo estado.
// Operações que podem falhar devolvem { data, error }; error é null em sucesso.

export const STORAGE_KEY = 'utilit_data';
export const SCHEMA_VERSION = '1.0';
const FALLBACK_TOPIC_SLUG = 'particao';

const ok = (data, extra = {}) => ({ data, error: null, ...extra });
const fail = (error) => ({ data: null, error });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// ---------- Estado e persistência ----------

export const THEMES = ['dark', 'light'];

export function emptyData() {
  return { version: SCHEMA_VERSION, topics: [], orphans: [], settings: {} };
}

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    return sanitizeData(JSON.parse(raw));
  } catch (err) {
    console.error('UtiliT: não foi possível ler os dados salvos. Iniciando vazio.', err);
    return emptyData();
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('UtiliT: falha ao gravar no localStorage.', err);
    return false;
  }
}

// ---------- Textos, URLs e IDs ----------

export function cleanTitle(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// Chave de comparação: ignora maiúsculas, acentos e espaços extras.
export function titleKey(text) {
  return cleanTitle(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function slugify(text) {
  return titleKey(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || FALLBACK_TOPIC_SLUG;
}

// Aceita "exemplo.com" (vira https://) e devolve null se a URL for inválida.
export function normalizeUrl(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return null;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function urlKey(url) {
  return url.replace(/\/$/, '').toLowerCase();
}

export function domainOf(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

// Nome de ícone do Material Symbols: "Rocket Launch" / "rocket-launch" → "rocket_launch".
// Devolve null se não tiver o formato de um nome de símbolo.
export function normalizeIconName(raw) {
  const name = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return /^[a-z0-9_]{1,64}$/.test(name) ? name : null;
}

// Slug de marca do thesvg.org (ex.: "youtube", "amazon-music").
// null = "já procurado, sem marca"; undefined = ausente/inválido (ainda não resolvido).
export function normalizeBrand(raw) {
  if (raw === null) return null;
  const slug = String(raw ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,80}$/.test(slug) ? slug : undefined;
}

// Fallback quando o site não tem marca no thesvg (ou o SVG não carrega).
export function faviconUrl(url) {
  return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`;
}

// ---------- Marcas (thesvg.org) ----------

// Sufixos de 2 níveis comuns (exemplo.com.br, exemplo.co.uk): o "nome" do domínio vem antes deles.
const SECOND_LEVEL = new Set(['com', 'co', 'org', 'net', 'gov', 'edu', 'ac', 'gob', 'or', 'ne']);

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Nome principal do domínio: "music.youtube.com" → "youtube"; "globo.com.br" → "globo".
function domainLabel(host) {
  const labels = host.split('.');
  if (labels.length < 2) return labels[0] ?? '';
  const twoLevel = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2));
  return labels.at(twoLevel ? -3 : -2);
}

// Índice de busca a partir do manifesto do thesvg (registry.json → icons[]).
// byHost: domínio da home oficial → slug. byName: slug/alias → slug.
export function buildBrandIndex(icons) {
  const list = (Array.isArray(icons) ? icons : [])
    .filter((i) => isObject(i) && normalizeBrand(i.slug))
    .map((i) => ({
      slug: i.slug,
      title: cleanTitle(i.title) || i.slug,
      aliases: Array.isArray(i.aliases) ? i.aliases.map((a) => String(a).toLowerCase()) : [],
      url: typeof i.url === 'string' ? i.url : '',
      variants: Array.isArray(i.variants) ? i.variants.map(String) : [],
    }));

  const byHost = new Map();
  // Quando vários slugs apontam para a mesma home, vence o igual ao nome do domínio,
  // depois o que não é "-badge", depois o mais curto.
  const rank = (slug, host) => [slug === domainLabel(host) ? 0 : 1, slug.endsWith('-badge') ? 1 : 0, slug.length];
  const better = (a, b, host) => {
    const [x, y] = [rank(a, host), rank(b, host)];
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k];
    return a < b;
  };
  for (const brand of list) {
    let url;
    try {
      url = new URL(brand.url);
    } catch {
      continue;
    }
    if (url.pathname !== '/' && url.pathname !== '') continue; // só homes (não repositórios, wikis etc.)
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const current = byHost.get(host);
    if (!current || better(brand.slug, current, host)) byHost.set(host, brand.slug);
  }

  const byName = new Map();
  for (const brand of list) byName.set(brand.slug, brand.slug);
  for (const brand of list) {
    for (const alias of brand.aliases) {
      const key = alias.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (key && !byName.has(key)) byName.set(key, brand.slug);
    }
  }
  return { list, byHost, byName, slugs: new Set(list.map((b) => b.slug)) };
}

// Marca de um endereço: 1º domínio da home oficial (subdomínio herda o domínio-pai);
// 2º nome do domínio igual a um slug/alias. Devolve o slug ou null.
export function matchBrand(index, url) {
  const host = hostOf(url);
  if (!index || !host) return null;
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    if (index.byHost.has(candidate)) return index.byHost.get(candidate);
  }
  return index.byName.get(domainLabel(host)) ?? null;
}

// Resolve a marca dos atalhos que ainda não têm "brand" (null quando não há marca).
export function resolveMissingBrands(data, index) {
  let changed = false;
  const fill = (list) =>
    list.map((site) => {
      if (site.brand !== undefined) return site;
      changed = true;
      return { ...site, brand: matchBrand(index, site.url) };
    });
  const next = { ...data, orphans: fill(data.orphans), topics: data.topics.map((t) => ({ ...t, sites: fill(t.sites) })) };
  return { data: changed ? next : data, changed };
}

export function hasMissingBrands(data) {
  const missing = (list) => list.some((s) => s.brand === undefined);
  return missing(data.orphans) || data.topics.some((t) => missing(t.sites));
}

// Há algo para compartilhar: ao menos uma partição (mesmo vazia) ou um atalho órfão.
export function hasContent(data) {
  return data.topics.length > 0 || data.orphans.length > 0;
}

// Slug do título, com sufixo numérico se já existir (ex.: divisao-1, divisao-1-2).
export function uniqueTopicId(topics, title) {
  const taken = new Set(topics.map((t) => t.id));
  const base = slugify(title);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function allSiteIds(data) {
  const ids = new Set(data.orphans.map((s) => s.id));
  for (const topic of data.topics) for (const s of topic.sites) ids.add(s.id);
  return ids;
}

function newSiteId(taken) {
  let n = Date.now();
  while (taken.has(`site_${n}`)) n++;
  const id = `site_${n}`;
  taken.add(id);
  return id;
}

// Garante IDs de site únicos: mantém o existente livre de conflito, troca os demais.
function claimIds(sites, taken) {
  return sites.map((site) => {
    if (site.id && !taken.has(site.id)) {
      taken.add(site.id);
      return site;
    }
    return { ...site, id: newSiteId(taken) };
  });
}

// ---------- Sanitização (dados vindos do localStorage ou de backup) ----------

function toSite(raw) {
  if (!isObject(raw)) return null;
  const url = normalizeUrl(raw.url);
  if (!url) return null;
  return withIcon({ id: raw.id ? String(raw.id) : '', name: cleanTitle(raw.name) || domainOf(url), url }, raw.icon, raw.brand);
}

// Campos opcionais do ícone:
// icon  = Material Symbol escolhido (tem prioridade);
// brand = slug do thesvg, null = sem marca, ausente = ainda não resolvido.
function withIcon(site, rawIcon, rawBrand) {
  const out = { ...site };
  const icon = normalizeIconName(rawIcon);
  if (icon) out.icon = icon;
  const brand = normalizeBrand(rawBrand);
  if (brand !== undefined) out.brand = brand;
  return out;
}

function toSettings(raw) {
  const settings = {};
  if (!isObject(raw)) return settings;
  if (THEMES.includes(raw.theme)) settings.theme = raw.theme;
  const accent = normalizeHex(raw.accent);
  if (accent) settings.accent = accent;
  return settings;
}

const toSites = (list) => (Array.isArray(list) ? list.map(toSite).filter(Boolean) : []);

export function sanitizeData(raw) {
  if (!isObject(raw) || !Array.isArray(raw.topics)) return emptyData();
  const taken = new Set();
  const topics = raw.topics
    .filter(isObject)
    .map((t) => ({
      id: t.id ? String(t.id) : slugify(t.title),
      title: cleanTitle(t.title),
      sites: claimIds(toSites(t.sites), taken),
    }))
    .filter((t) => t.title);
  const orphans = claimIds(toSites(raw.orphans), taken);
  return { version: SCHEMA_VERSION, topics, orphans, settings: toSettings(raw.settings) };
}

// ---------- Preferências ----------

// theme: 'dark' | 'light' | null (null = seguir o sistema).
// accent: cor de destaque '#rrggbb' | null (null = Padrão: branco no escuro, grafite no claro).
export function setAppearance(data, { theme = null, accent = null }) {
  if (theme !== null && !THEMES.includes(theme)) return fail('Tema inválido.');
  const color = accent === null ? null : normalizeHex(accent);
  if (accent !== null && !color) return fail('Cor inválida. Use o formato #RGB ou #RRGGBB.');
  const settings = { ...data.settings };
  if (theme) settings.theme = theme;
  else delete settings.theme;
  if (color) settings.accent = color;
  else delete settings.accent;
  return ok({ ...data, settings });
}

// ---------- Cor de destaque (tema) ----------

// Fundo de cada modo (mesmos valores de --background-dark-color em style.css).
export const MODE_BACKGROUNDS = { dark: '#202020', light: '#ececec' };
export const MIN_ACCENT_CONTRAST = 3; // WCAG: mínimo para elementos gráficos e texto grande
const ON_ACCENT = { dark: '#1c1c1c', light: '#f2f2f2' }; // texto sobre a face da cor

// 15 cores: "Padrão" (null) + 14 calibradas para contraste ≥ 3:1 nos dois modos.
export const ACCENT_PALETTE = [
  { name: 'Padrão', hex: null },
  { name: 'Cinza', hex: '#7d8189' },
  { name: 'Vermelho', hex: '#e5484d' },
  { name: 'Laranja', hex: '#d55f24' },
  { name: 'Âmbar', hex: '#b0770b' },
  { name: 'Amarelo', hex: '#938004' },
  { name: 'Lima', hex: '#6f8e16' },
  { name: 'Verde', hex: '#379745' },
  { name: 'Esmeralda', hex: '#0f9774' },
  { name: 'Ciano', hex: '#138ea8' },
  { name: 'Azul', hex: '#3b7ef0' },
  { name: 'Índigo', hex: '#6a6ff0' },
  { name: 'Violeta', hex: '#9061f0' },
  { name: 'Rosa', hex: '#d94b90' },
  { name: 'Magenta', hex: '#c64ad6' },
];

// Aceita #RGB ou #RRGGBB, com ou sem '#', sem diferenciar maiúsculas. Devolve '#rrggbb' ou null.
export function normalizeHex(raw) {
  const text = String(raw ?? '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(text)) return `#${text}`;
  if (/^[0-9a-f]{3}$/.test(text)) return `#${[...text].map((c) => c + c).join('')}`;
  return null;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

const rgbToHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

// Luminância relativa (WCAG 2.x).
function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const accentContrast = (accent, mode) => contrastRatio(accent, MODE_BACKGROUNDS[mode]);

// Modo em que a cor fica legível: o atual, se o contraste bastar; senão o outro.
// Se nenhum dos dois atingir o mínimo, fica o de maior contraste.
export function accentModeFor(accent, mode) {
  if (accentContrast(accent, mode) >= MIN_ACCENT_CONTRAST) return mode;
  const other = mode === 'dark' ? 'light' : 'dark';
  return accentContrast(accent, other) > accentContrast(accent, mode) ? other : mode;
}

function rgbToHsl([r, g, b]) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((c) => c * 255);
}

// Cor exibida num modo: a própria, se legível; senão clareia (escuro) ou escurece (claro)
// mantendo o matiz até atingir o contraste mínimo com o fundo.
export function accentForMode(accent, mode) {
  if (accentContrast(accent, mode) >= MIN_ACCENT_CONTRAST) return accent;
  const [h, s, l] = rgbToHsl(hexToRgb(accent));
  const step = mode === 'dark' ? 0.01 : -0.01;
  for (let next = l + step; next >= 0 && next <= 1; next += step) {
    const candidate = rgbToHex(hslToRgb([h, s, next]));
    if (accentContrast(candidate, mode) >= MIN_ACCENT_CONTRAST) return candidate;
  }
  return mode === 'dark' ? '#ffffff' : '#000000';
}

// Tokens da cor de destaque para a interface: cor exibida, canais RGB e texto sobre ela.
export function accentTokens(accent, mode) {
  const color = accentForMode(accent, mode);
  const on = contrastRatio(color, ON_ACCENT.dark) >= contrastRatio(color, ON_ACCENT.light) ? ON_ACCENT.dark : ON_ACCENT.light;
  return { color, rgb: hexToRgb(color).join(', '), on };
}

// ---------- Mesclagem de listas de sites ----------

// Sites de "incoming" substituem os de "base" com o mesmo endereço; os demais são anexados.
export function mergeSites(base, incoming) {
  const incomingByKey = new Map(incoming.map((s) => [urlKey(s.url), s]));
  const placed = new Set();
  const out = base.map((s) => {
    const key = urlKey(s.url);
    if (!incomingByKey.has(key)) return s;
    placed.add(key);
    return incomingByKey.get(key);
  });
  for (const s of incoming) {
    const key = urlKey(s.url);
    if (!placed.has(key)) {
      placed.add(key);
      out.push(s);
    }
  }
  return out;
}

// ---------- Helpers internos de listas ----------

// topicId === null representa a lista de órfãos.
function listOf(data, topicId) {
  if (topicId === null) return data.orphans;
  return data.topics.find((t) => t.id === topicId)?.sites ?? null;
}

function updateList(data, topicId, fn) {
  if (topicId === null) return { ...data, orphans: fn(data.orphans) };
  return { ...data, topics: data.topics.map((t) => (t.id === topicId ? { ...t, sites: fn(t.sites) } : t)) };
}

// ---------- Partições ----------

export function createTopic(data, rawTitle) {
  const title = cleanTitle(rawTitle);
  if (!title) return fail('Informe um nome para a partição.');
  const existing = data.topics.find((t) => titleKey(t.title) === titleKey(title));
  if (existing) return ok(data, { topicId: existing.id, merged: true });
  const id = uniqueTopicId(data.topics, title);
  return ok({ ...data, topics: [...data.topics, { id, title, sites: [] }] }, { topicId: id, merged: false });
}

// Renomear para o nome de outra partição mescla as duas (a renomeada deixa de existir).
export function renameTopic(data, topicId, rawTitle) {
  const title = cleanTitle(rawTitle);
  if (!title) return fail('Informe um nome para a partição.');
  const topic = data.topics.find((t) => t.id === topicId);
  if (!topic) return fail('Partição não encontrada.');
  const duplicate = data.topics.find((t) => t.id !== topicId && titleKey(t.title) === titleKey(title));
  if (!duplicate) {
    return ok({ ...data, topics: data.topics.map((t) => (t.id === topicId ? { ...t, title } : t)) }, { topicId, merged: false });
  }
  const merged = { ...duplicate, sites: mergeSites(duplicate.sites, topic.sites) };
  const topics = data.topics
    .filter((t) => t.id !== topicId)
    .map((t) => (t.id === duplicate.id ? merged : t));
  return ok({ ...data, topics }, { topicId: duplicate.id, merged: true });
}

// keepSites = false → atalhos são excluídos. true → viram órfãos.
export function deleteTopic(data, topicId, deleteSites) {
  const topic = data.topics.find((t) => t.id === topicId);
  if (!topic) return fail('Partição não encontrada.');
  return ok({
    ...data,
    topics: data.topics.filter((t) => t.id !== topicId),
    orphans: deleteSites ? data.orphans : mergeSites(data.orphans, topic.sites),
  });
}

// Move todos os atalhos de uma partição para outra, ou para os órfãos (toId null).
// A origem fica vazia. Duplicatas seguem a regra da mesclagem: o movido substitui o existente.
export function moveTopicSites(data, fromId, toId) {
  if (fromId === toId) return fail('Escolha um destino diferente.');
  const from = data.topics.find((t) => t.id === fromId);
  if (!from) return fail('Partição não encontrada.');
  if (toId !== null && !data.topics.some((t) => t.id === toId)) return fail('Partição não encontrada.');
  const moving = from.sites;
  return ok({
    ...data,
    topics: data.topics.map((t) => {
      if (t.id === fromId) return { ...t, sites: [] };
      if (t.id === toId) return { ...t, sites: mergeSites(t.sites, moving) };
      return t;
    }),
    orphans: toId === null ? mergeSites(data.orphans, moving) : data.orphans,
  });
}

// Reordena partições: coloca as indicadas antes de beforeTopicId (ou no fim, se ausente).
export function reorderTopics(data, topicIds, beforeTopicId = null) {
  const moving = [];
  for (const id of topicIds) {
    const topic = data.topics.find((t) => t.id === id);
    if (topic && !moving.includes(topic)) moving.push(topic);
  }
  if (moving.length === 0) return fail('Nenhuma partição para mover.');
  const rest = data.topics.filter((t) => !moving.includes(t));
  const at = rest.findIndex((t) => t.id === beforeTopicId);
  const index = at < 0 ? rest.length : at;
  return ok({ ...data, topics: [...rest.slice(0, index), ...moving, ...rest.slice(index)] });
}

// ---------- Atalhos ----------

export function findSite(data, siteId) {
  if (!siteId) return null;
  const orphan = data.orphans.find((s) => s.id === siteId);
  if (orphan) return { site: orphan, topicId: null };
  for (const topic of data.topics) {
    const site = topic.sites.find((s) => s.id === siteId);
    if (site) return { site, topicId: topic.id };
  }
  return null;
}

// Cria (siteId ausente) ou edita um atalho. topicId null = sem partição (órfão).
// icon: nome do Material Symbols; vazio volta para o ícone automático.
// brand: slug do thesvg, null = sem marca, undefined = resolver depois.
export function saveSite(data, { siteId = null, name, url, topicId = null, icon = '', brand = undefined }) {
  const cleanUrl = normalizeUrl(url);
  if (!cleanUrl) return fail('URL inválida. Use algo como exemplo.com ou https://exemplo.com.');

  const targetList = listOf(data, topicId);
  if (!targetList) return fail('Partição não encontrada.');

  const key = urlKey(cleanUrl);
  if (targetList.some((s) => s.id !== siteId && urlKey(s.url) === key)) {
    return fail('Este endereço já existe nesta partição.');
  }
  if (String(icon ?? '').trim() && !normalizeIconName(icon)) {
    return fail('Nome de ícone inválido. Use letras, números e "_" (ex.: rocket_launch).');
  }

  const current = findSite(data, siteId);
  const site = withIcon({
    id: current?.site.id ?? newSiteId(allSiteIds(data)),
    name: cleanTitle(name) || domainOf(cleanUrl),
    url: cleanUrl,
  }, icon, brand);

  if (current && current.topicId === topicId) {
    return ok(updateList(data, topicId, (list) => list.map((s) => (s.id === site.id ? site : s))));
  }
  let next = current ? updateList(data, current.topicId, (list) => list.filter((s) => s.id !== site.id)) : data;
  next = updateList(next, topicId, (list) => [...list, site]);
  return ok(next);
}

// Move atalhos (de qualquer partição ou dos órfãos) para o destino, antes de beforeSiteId
// (ou no fim). topicId null = órfãos. No destino, um atalho com a mesma URL é substituído.
export function moveSitesTo(data, siteIds, topicId = null, beforeSiteId = null) {
  if (listOf(data, topicId) === null) return fail('Partição não encontrada.');

  const seenIds = new Set();
  const seenUrls = new Set();
  const moving = [];
  for (const id of siteIds) {
    const found = findSite(data, id);
    if (!found || seenIds.has(id)) continue;
    seenIds.add(id);
    const key = urlKey(found.site.url);
    if (seenUrls.has(key)) continue; // dois iguais na seleção: o segundo fica onde está
    seenUrls.add(key);
    moving.push(found.site);
  }
  if (moving.length === 0) return fail('Nenhum atalho para mover.');

  const movingIds = new Set(moving.map((s) => s.id));
  const without = (list) => list.filter((s) => !movingIds.has(s.id));
  const stripped = {
    ...data,
    orphans: without(data.orphans),
    topics: data.topics.map((t) => ({ ...t, sites: without(t.sites) })),
  };

  const movingKeys = new Set(moving.map((s) => urlKey(s.url)));
  const target = listOf(stripped, topicId).filter((s) => !movingKeys.has(urlKey(s.url)));
  const at = target.findIndex((s) => s.id === beforeSiteId);
  const index = at < 0 ? target.length : at;
  return ok(updateList(stripped, topicId, () => [...target.slice(0, index), ...moving, ...target.slice(index)]));
}

export function deleteSite(data, siteId) {
  const current = findSite(data, siteId);
  if (!current) return fail('Atalho não encontrado.');
  return ok(updateList(data, current.topicId, (list) => list.filter((s) => s.id !== siteId)));
}

// Remove vários atalhos de uma vez (de qualquer partição ou dos órfãos).
export function deleteSites(data, siteIds) {
  const ids = new Set(siteIds);
  if (!ids.size) return fail('Nenhum atalho selecionado.');
  const keep = (list) => list.filter((s) => !ids.has(s.id));
  return ok({
    ...data,
    topics: data.topics.map((t) => ({ ...t, sites: keep(t.sites) })),
    orphans: keep(data.orphans),
  });
}

// Remove várias partições. Sem deleteSitesToo, os atalhos delas viram órfãos.
export function deleteTopics(data, topicIds, deleteSitesToo) {
  const ids = new Set(topicIds);
  const removed = data.topics.filter((t) => ids.has(t.id));
  if (!removed.length) return fail('Partição não encontrada.');
  return ok({
    ...data,
    topics: data.topics.filter((t) => !ids.has(t.id)),
    orphans: deleteSitesToo ? data.orphans : mergeSites(data.orphans, removed.flatMap((t) => t.sites)),
  });
}

// ---------- Importação ----------

// Partição com o mesmo nome: substitui título/ID pelo do backup e mescla os sites.
// Sites antigos ausentes no backup são preservados. Órfãos são somados com dedupe por URL.
// As preferências atuais (tema e cor de destaque) não são sobrescritas pelo backup.
export function mergeImported(current, raw) {
  const incoming = sanitizeData(raw);
  const taken = allSiteIds(current);
  const incomingTopics = incoming.topics.map((t) => ({ ...t, sites: claimIds(t.sites, taken) }));
  const incomingOrphans = claimIds(incoming.orphans, taken);

  const topics = [...current.topics];
  for (const t of incomingTopics) {
    const idx = topics.findIndex((x) => titleKey(x.title) === titleKey(t.title));
    if (idx >= 0) {
      const old = topics[idx];
      const idFree = t.id && !topics.some((x, i) => i !== idx && x.id === t.id);
      topics[idx] = { id: idFree ? t.id : old.id, title: t.title, sites: mergeSites(old.sites, t.sites) };
    } else {
      const idFree = t.id && !topics.some((x) => x.id === t.id);
      const id = idFree ? t.id : uniqueTopicId(topics, t.title);
      topics.push({ id, title: t.title, sites: mergeSites([], t.sites) });
    }
  }

  return {
    version: SCHEMA_VERSION,
    topics,
    orphans: mergeSites(current.orphans, incomingOrphans),
    settings: { ...current.settings },
  };
}
