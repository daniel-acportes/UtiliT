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

export function emptyData() {
  return { version: SCHEMA_VERSION, topics: [], orphans: [] };
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

export function faviconUrl(url) {
  return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`;
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
  return { id: raw.id ? String(raw.id) : '', name: cleanTitle(raw.name) || domainOf(url), url };
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
  return { version: SCHEMA_VERSION, topics, orphans };
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
export function saveSite(data, { siteId = null, name, url, topicId = null }) {
  const cleanUrl = normalizeUrl(url);
  if (!cleanUrl) return fail('URL inválida. Use algo como exemplo.com ou https://exemplo.com.');

  const targetList = listOf(data, topicId);
  if (!targetList) return fail('Partição não encontrada.');

  const key = urlKey(cleanUrl);
  if (targetList.some((s) => s.id !== siteId && urlKey(s.url) === key)) {
    return fail('Este endereço já existe nesta partição.');
  }

  const current = findSite(data, siteId);
  const site = {
    id: current?.site.id ?? newSiteId(allSiteIds(data)),
    name: cleanTitle(name) || domainOf(cleanUrl),
    url: cleanUrl,
  };

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
  };
}
