// Manipulação do DOM: renderização, menus flutuantes, modais e toasts.
// Não contém regras de negócio: recebe dados prontos e devolve ações via callbacks.
// Todo texto vindo do usuário ou de backups é inserido com textContent (nunca innerHTML).

import { faviconUrl, normalizeIconName, normalizeUrl, buildBrandIndex, matchBrand, normalizeHex } from './storage.js';

const FALLBACK_ICON = './assets/icone-site.png';
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
const EDGE_MARGIN_PX = 8;

let activeModal = null; // { overlay, close }
let activeMenu = null;  // { anchor, contains(target), close(instant) }

const $ = (selector, root = document) => root.querySelector(selector);

// ---------- Movimento ----------

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => motionQuery.matches;

// Remove o nó depois da animação de saída definida no CSS.
function removeLater(node, ms) {
  setTimeout(() => node.remove(), reducedMotion() ? 0 : ms);
}
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function el(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function setStyles(node, styles) {
  Object.assign(node.style, styles);
}

// Todos os ícones da interface (exceto favicons de sites) vêm do Google Material Symbols.
// name = nome do ícone em https://fonts.google.com/icons (ex.: 'delete', 'settings', 'add').
function icon(name) {
  const node = el('span', 'material-symbols-outlined', name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// ---------- Tema e ícones dicromáticos ----------

const DUO_FILTER_ID = 'utilit-duo';
const THEME_SWAP_MS = 450;
let themeSwapTimer = null;

// Lê uma cor (token CSS) já resolvida, no formato rgb()/rgba().
function cssColor(token) {
  const probe = el('span');
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${token})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

// Filtro SVG de silhueta dicromática: pixel opaco (alfa ≥ 50%) e não-claro (luminância < 70%)
// vira a cor de traço (= fundo do site); todo o resto fica transparente e mostra o próprio
// tile. Resultado: só 2 cores visíveis (traço + tile). Atua só na renderização, então
// funciona com favicons de outra origem (o serviço de favicons não libera CORS para canvas).
function ensureDuoFilter() {
  if (document.getElementById(DUO_FILTER_ID)) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  // Conteúdo estático (nenhum dado do usuário).
  // escuro: alfa = 1 - luminância, cortado em 0.3 (tabela de 10 faixas → ≥ 0.3 vira 1).
  // opaco: alfa original binarizado em 0.5. A máscara final é a interseção dos dois.
  svg.innerHTML = `
    <defs>
      <filter id="${DUO_FILTER_ID}" color-interpolation-filters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix" result="luz"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.2126 -0.7152 -0.0722 0 1" />
        <feComponentTransfer in="luz" result="escuro">
          <feFuncA type="discrete" tableValues="0 0 0 1 1 1 1 1 1 1" />
        </feComponentTransfer>
        <feComponentTransfer in="SourceAlpha" result="opaco">
          <feFuncA type="discrete" tableValues="0 1" />
        </feComponentTransfer>
        <feComposite in="escuro" in2="opaco" operator="in" result="mascara" />
        <feFlood class="duo-tinta" flood-color="#202020" result="tinta" />
        <feComposite in="tinta" in2="mascara" operator="in" />
      </filter>
    </defs>`;
  document.body.append(svg);
}

// Sincroniza as cores dos filtros SVG com os tokens do tema ativo.
function syncFilterColors() {
  ensureDuoFilter();
  document.querySelector(`#${DUO_FILTER_ID} .duo-tinta`).setAttribute('flood-color', cssColor('--duo-ink'));
  document.querySelector(`#${GOO_FILTER_ID} feFlood`)?.setAttribute('flood-color', cssColor('--primary-color'));
}

const ACCENT_PROPS = { color: '--accent', rgb: '--accent-rgb', on: '--accent-on' };

// theme: 'dark' | 'light'. animate = transição suave de cores (troca pelo usuário/sistema).
// accent: { color, rgb, on } (tokens da cor de destaque já ajustados ao modo) ou null = Padrão.
export function applyTheme(theme, animate = false, accent = null) {
  const root = document.documentElement;
  if (animate && !reducedMotion()) {
    clearTimeout(themeSwapTimer);
    root.classList.add('tema-trocando');
    themeSwapTimer = setTimeout(() => root.classList.remove('tema-trocando'), THEME_SWAP_MS);
  }
  root.dataset.theme = theme;
  for (const [key, prop] of Object.entries(ACCENT_PROPS)) {
    if (accent) root.style.setProperty(prop, accent[key]);
    else root.style.removeProperty(prop);
  }
  if (accent) root.dataset.accent = '';
  else delete root.dataset.accent;
  syncFilterColors();
}

// ---------- Renderização da página ----------

let renderedOnce = false;

export function renderApp(data, handlers) {
  closeFloatingMenu(true);
  resetDragAndSelection();
  renderNav(data.topics);

  const before = captureLayout();
  const sections = [];
  if (data.orphans.length) sections.push(createOrphanSection(data.orphans, handlers));
  for (const topic of data.topics.filter((t) => t.sites.length > 0)) {
    sections.push(createTopicSection(topic, handlers, false));
  }
  // Partições vazias ficam por último, minimizadas.
  for (const topic of data.topics.filter((t) => t.sites.length === 0)) {
    sections.push(createTopicSection(topic, handlers, true));
  }
  $('#app').replaceChildren(...sections);
  animateLayout(before);
  renderedOnce = true;
  updateNav();
  updateActiveNav();
}

function renderNav(topics) {
  const nav = $('.nav-links');
  nav.replaceChildren(
    ...topics.map((topic) => {
      const item = el('li');
      const link = el('a', 'nav-link', topic.title);
      link.href = `#${topic.id}`;
      item.append(link);
      return item;
    }),
  );
  activeNavId = null;
}

// ---------- Animação entre renderizações (FLIP) ----------

// Toda ação refaz o DOM; guardamos as posições antigas para os elementos
// deslizarem até o novo lugar em vez de saltarem. Elementos novos surgem com fade.
function layoutKey(node) {
  return node.classList.contains('site') ? `site:${node.dataset.siteId}` : `sec:${node.id}`;
}

function captureLayout() {
  const map = new Map();
  for (const node of document.querySelectorAll('#app > section, #app .site')) {
    map.set(layoutKey(node), node.getBoundingClientRect());
  }
  return map;
}

const POP_IN = [
  { opacity: 0, transform: 'scale(0.7)' },
  { opacity: 1, transform: 'none' },
];

function animateLayout(before) {
  if (reducedMotion()) return;
  const first = !renderedOnce;
  const info = new Map(); // seção -> { shift, index, isNew }

  [...$('#app').children].forEach((section, index) => {
    const old = before.get(layoutKey(section));
    if (!old) {
      info.set(section, { shift: 0, index, isNew: true });
      section.animate(
        [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }],
        { duration: 520, delay: first ? index * 70 : 0, easing: EASE_OUT, fill: 'backwards' },
      );
      return;
    }
    const shift = old.top - section.getBoundingClientRect().top;
    info.set(section, { shift, index, isNew: false });
    if (Math.abs(shift) > 1) {
      section.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: 420, easing: EASE_OUT });
    }
  });

  for (const site of $('#app').querySelectorAll('.site')) {
    const section = info.get(site.closest('section'));
    if (section.isNew) {
      // Seção nova entra como bloco; só na primeira carga os atalhos surgem em cascata.
      if (!first) continue;
      const i = Math.min([...site.parentNode.children].indexOf(site), 14);
      site.animate(POP_IN, { duration: 480, delay: section.index * 70 + i * 35, easing: EASE_SPRING, fill: 'backwards' });
      continue;
    }
    const old = before.get(layoutKey(site));
    if (!old) {
      site.animate(POP_IN, { duration: 480, easing: EASE_SPRING });
      continue;
    }
    const now = site.getBoundingClientRect();
    // Desconta o deslocamento da própria seção, que já está sendo animado.
    const dx = old.left - now.left;
    const dy = old.top - now.top - section.shift;
    if (Math.hypot(dx, dy) > 1) {
      site.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 450, easing: EASE_OUT });
    }
  }
}

function createTopicSection(topic, handlers, minimized) {
  const section = el('section', minimized ? 'divisao minimizado' : 'divisao');
  section.id = topic.id;

  const container = el('div', 'topico container');
  const header = el('div', 'nome-topico');
  const title = el('h1', '', topic.title);
  header.append(title);
  attachLongPress(header, () =>
    openGearMenu({
      anchor: header,
      shape: title,
      kind: 'topic',
      items: [
        { label: 'Editar partição', icon: 'edit', onClick: () => handlers.onEditTopic(topic.id) },
        { label: 'Mover atalhos', icon: 'drive_file_move', onClick: () => handlers.onMoveTopicSites(topic.id) },
        { label: 'Excluir partição', icon: 'delete', danger: true, onClick: () => handlers.onDeleteTopic(topic.id) },
      ],
    }),
  );

  container.append(header, createGrid(topic.sites, handlers));
  section.append(container);
  return section;
}

// Atalhos sem partição: grid no topo da página, sem cabeçalho de partição.
function createOrphanSection(sites, handlers) {
  const section = el('section', 'divisao orfaos');
  section.id = 'sem-particao';
  const container = el('div', 'topico container');
  container.append(createGrid(sites, handlers));
  section.append(container);
  return section;
}

function createGrid(sites, handlers) {
  const grid = el('div', 'sites-grid');
  grid.append(...sites.map((site) => createSiteElement(site, handlers)));
  return grid;
}

function createSiteElement(site, handlers) {
  const wrapper = el('div', 'site');
  wrapper.dataset.siteId = site.id;

  const button = el('div', 'button');
  const link = el('a');
  link.href = site.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.draggable = false; // o arraste é tratado por nós, não pelo navegador

  link.append(createSiteIcon(site));
  button.append(link);
  wrapper.append(button, el('h2', 'site-name', site.name));

  attachLongPress(wrapper, () =>
    openGearMenu({
      anchor: wrapper,
      shape: button,
      kind: 'site',
      items: [
        { label: 'Editar atalho', icon: 'edit', onClick: () => handlers.onEditSite(site.id) },
        { label: 'Excluir atalho', icon: 'delete', danger: true, onClick: () => handlers.onDeleteSite(site.id) },
      ],
    }),
  );
  return wrapper;
}

// ---------- Ícones de marca (thesvg.org) ----------

const BRAND_BASE = 'https://thesvg.org';
const BRAND_REGISTRY_URL = `${BRAND_BASE}/api/registry.json`;
const brandSvgUrl = (slug, variant = 'default') => `${BRAND_BASE}/icons/${encodeURIComponent(slug)}/${variant}.svg`;

// A variante "mono" é a preferida (poucas cores, combina com o visual minimalista);
// sem ela, usa a "default". Quando o manifesto já foi baixado, sabemos de antemão
// quais marcas não têm mono e evitamos a requisição que daria 404.
let knownVariants = null; // Map slug → variantes, preenchido quando o manifesto carrega
const preferredVariant = (slug) => (knownVariants && !knownVariants.get(slug)?.includes('mono') ? 'default' : 'mono');

let brandIndexPromise = null;

// Manifesto do thesvg (~1,9 MB), baixado só quando preciso e indexado uma vez por sessão.
export function loadBrandIndex() {
  if (!brandIndexPromise) {
    brandIndexPromise = (async () => {
      const response = await fetch(BRAND_REGISTRY_URL);
      if (!response.ok) throw new Error(`thesvg respondeu ${response.status}`);
      let registry;
      try {
        registry = JSON.parse(await response.text());
      } catch {
        throw new Error('Manifesto do thesvg inválido.');
      }
      const index = buildBrandIndex(registry?.icons);
      knownVariants = new Map(index.list.map((b) => [b.slug, b.variants]));
      return index;
    })();
    brandIndexPromise.catch(() => { brandIndexPromise = null; }); // permite tentar de novo depois
  }
  return brandIndexPromise;
}

// slug → <svg> pronto (modelo para clonar) ou null se falhou. Mantém re-renderizações instantâneas.
const brandSvgCache = new Map();
const brandSvgLoading = new Map();

function loadBrandSvg(slug) {
  if (brandSvgCache.has(slug)) return Promise.resolve(brandSvgCache.get(slug));
  if (!brandSvgLoading.has(slug)) {
    const job = (async () => {
      try {
        let response = await fetch(brandSvgUrl(slug, preferredVariant(slug)));
        if (!response.ok && preferredVariant(slug) === 'mono') response = await fetch(brandSvgUrl(slug, 'default'));
        if (!response.ok) throw new Error(`thesvg respondeu ${response.status}`);
        const svg = prepareBrandSvg(await response.text(), slug);
        brandSvgCache.set(slug, svg);
        return svg;
      } catch (err) {
        console.warn(`UtiliT: ícone "${slug}" indisponível; usando o favicon.`, err);
        brandSvgCache.set(slug, null);
        return null;
      } finally {
        brandSvgLoading.delete(slug);
      }
    })();
    brandSvgLoading.set(slug, job);
  }
  return brandSvgLoading.get(slug);
}

const BRAND_UNSAFE_TAGS = 'script, foreignObject, iframe, object, embed, a, image, audio, video, animate, set, animateMotion, animateTransform, handler, listener';
const COLOR_PROPS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color'];
const URL_REF = /url\(\s*['"]?\s*#([^'")\s]+)\s*['"]?\s*\)/g;
const EXTERNAL_URL = /url\((?!\s*['"]?\s*#)/i; // qualquer url() que não seja referência interna
const CSS_COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/gi;

// Converte qualquer cor CSS em [r, g, b] (0–255) usando o parser do canvas (sem imagens: sem CORS).
const colorProbe = document.createElement('canvas').getContext('2d');
function parseColor(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || ['none', 'transparent', 'currentcolor', 'inherit', 'initial'].includes(v) || v.startsWith('url(')) return null;
  colorProbe.fillStyle = '#010203';
  colorProbe.fillStyle = v;
  const out = colorProbe.fillStyle;
  if (out === '#010203' && v !== '#010203') return null; // cor não reconhecida
  if (out.startsWith('#')) return [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
  return out.match(/[\d.]+/g).slice(0, 3).map(Number);
}

const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// Mapeia as cores do SVG para no máximo 3 tons: traço (fundo do site), meio-tom e papel (tile).
// Quase branco vira papel (vazados); escuro vira traço; o resto, meio-tom. Se nada cair no
// traço, a cor mais escura vai para ele, para o ícone nunca ficar apagado.
function toneMap(colors) {
  const tones = new Map();
  const solid = [];
  for (const [key, rgb] of colors) {
    const lum = luminance(rgb);
    if (lum > 0.85) tones.set(key, 'paper');
    else {
      tones.set(key, lum < 0.5 ? 'ink' : 'mid');
      solid.push([lum, key]);
    }
  }
  if (!solid.length) for (const key of tones.keys()) tones.set(key, 'ink'); // ícone todo claro
  else if (![...tones.values()].includes('ink')) tones.set(solid.sort((a, b) => a[0] - b[0])[0][1], 'ink');
  return tones;
}
const TONE_VAR = { ink: 'var(--duo-ink)', mid: 'var(--duo-mid)', paper: 'var(--duo-paper)' };

// Sanitiza (sem scripts, eventos ou referências externas), isola os IDs por marca e
// troca todas as cores pelos tokens de tom. Devolve um <svg> do documento atual.
function prepareBrandSvg(text, slug) {
  let parsed;
  try {
    parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch {
    throw new Error('SVG inválido.');
  }
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('SVG inválido.');
  const svg = document.importNode(parsed.documentElement, true);
  svg.querySelectorAll(BRAND_UNSAFE_TAGS).forEach((node) => node.remove());
  const nodes = [svg, ...svg.querySelectorAll('*')];

  // Sanitização de atributos e isolamento de IDs (vários SVGs inline na mesma página).
  const prefix = `marca-${slug}-`;
  for (const node of nodes) {
    for (const { name, value } of [...node.attributes]) {
      const lower = name.toLowerCase();
      const externalRef = (lower === 'href' || lower === 'xlink:href') && !value.trim().startsWith('#');
      const externalUrl = EXTERNAL_URL.test(value) || /javascript:/i.test(value);
      if (lower.startsWith('on') || externalRef || externalUrl) node.removeAttribute(name);
    }
    if (node.id) node.id = prefix + node.id;
    for (const attr of ['href', 'xlink:href']) {
      const ref = node.getAttribute(attr);
      if (ref?.startsWith('#')) node.setAttribute(attr, `#${prefix}${ref.slice(1)}`);
    }
    for (const { name, value } of [...node.attributes]) {
      if (value.includes('url(')) node.setAttribute(name, value.replace(URL_REF, (_, id) => `url(#${prefix}${id})`));
    }
  }
  for (const style of svg.querySelectorAll('style')) {
    if (/@import/i.test(style.textContent) || EXTERNAL_URL.test(style.textContent)) style.remove();
    else style.textContent = style.textContent.replace(URL_REF, (_, id) => `url(#${prefix}${id})`);
  }

  // 1ª passada: todas as cores usadas (atributos, style inline e <style>).
  const colors = new Map();
  const note = (value) => {
    const rgb = parseColor(value);
    if (rgb) colors.set(rgb.join(','), rgb);
    return rgb;
  };
  for (const node of nodes) {
    for (const prop of COLOR_PROPS) {
      note(node.getAttribute(prop));
      note(node.style?.getPropertyValue(prop));
    }
  }
  for (const style of svg.querySelectorAll('style')) (style.textContent.match(CSS_COLOR) ?? []).forEach(note);
  // Formas sem cor declarada são pretas por padrão.
  colors.set('0,0,0', [0, 0, 0]);
  const tones = toneMap(colors);
  const toneOf = (value) => {
    const rgb = parseColor(value);
    return rgb ? TONE_VAR[tones.get(rgb.join(','))] : null;
  };

  // 2ª passada: troca as cores pelos tokens (inline style aceita var(); atributo não).
  for (const node of nodes) {
    for (const prop of COLOR_PROPS) {
      const fromAttr = toneOf(node.getAttribute(prop));
      if (fromAttr) {
        node.removeAttribute(prop);
        node.style.setProperty(prop, fromAttr);
      }
      const fromStyle = toneOf(node.style.getPropertyValue(prop));
      if (fromStyle) node.style.setProperty(prop, fromStyle);
    }
  }
  for (const style of svg.querySelectorAll('style')) {
    style.textContent = style.textContent.replace(CSS_COLOR, (match) => toneOf(match) ?? match);
  }
  // Raiz: preto padrão vira o tom correspondente; tamanho controlado pelo CSS.
  if (!svg.style.getPropertyValue('fill')) svg.style.setProperty('fill', toneOf('#000'));
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width'));
    const h = parseFloat(svg.getAttribute('height'));
    if (w && h) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.querySelectorAll('title').forEach((node) => node.remove());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

// Ícone de marca já recolorido; enquanto carrega fica vazio, se falhar mostra o favicon.
function brandIcon(slug, url) {
  const holder = el('span', 'marca-svg');
  const fill = (svg) => holder.replaceChildren(svg ? svg.cloneNode(true) : faviconImage(url));
  if (brandSvgCache.has(slug)) fill(brandSvgCache.get(slug));
  else loadBrandSvg(slug).then(fill);
  return holder;
}

// Ícone do atalho, por prioridade: Material Symbol escolhido > marca do thesvg > favicon.
// Todos aparecem nas cores do tema (tokens --duo-*).
function createSiteIcon(site) {
  if (site.icon) {
    const glyph = icon(site.icon);
    glyph.classList.add('site-glifo');
    glyph.setAttribute('role', 'img');
    glyph.removeAttribute('aria-hidden');
    glyph.setAttribute('aria-label', site.name);
    return glyph;
  }
  const node = site.brand ? brandIcon(site.brand, site.url) : faviconImage(site.url, site.name);
  if (site.brand) {
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', site.name);
  }
  return node;
}

function faviconImage(url, alt = '') {
  const img = el('img');
  img.alt = alt;
  img.draggable = false;
  img.src = faviconUrl(url);
  img.addEventListener('error', () => { img.src = FALLBACK_ICON; }, { once: true });
  return img;
}

// ---------- Long-press ----------

// Segura 500ms (ou clica com o botão direito); mover mais que a tolerância cancela.
// Após disparar pelo long-press, o clique seguinte (que abriria o link) é suprimido.
function attachLongPress(node, onLongPress) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  node.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    fired = false;
    startX = event.clientX;
    startY = event.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      onLongPress();
    }, LONG_PRESS_MS);
  });

  node.addEventListener('pointermove', (event) => {
    if (timer && Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE_PX) cancel();
  });

  ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => node.addEventListener(type, cancel));

  node.addEventListener(
    'click',
    (event) => {
      if (!fired) return;
      event.preventDefault();
      event.stopPropagation();
      fired = false;
    },
    true,
  );

  // Botão direito faz o mesmo que segurar o esquerdo, sem esperar os 500 ms.
  node.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    cancel();
    if (drag?.active) return;
    onLongPress();
  });
}

export function closeFloatingMenu(instant = false) {
  if (!activeMenu) return;
  const menu = activeMenu;
  activeMenu = null;
  menu.close(instant);
}

// ---------- Engrenagem em gota (long-press em atalho/partição) ----------

const GOO_FILTER_ID = 'utilit-goo';
const DROP_RADIUS = 21;     // raio da gota/engrenagem (42px)
const DROP_LAYER_PAD = 90;  // folga da camada filtrada ao redor do elemento
const DROP_EXIT_MS = 480;
const DROP_OUTLINE_PX = 2;  // mesma espessura da borda do elemento de origem

// Filtro SVG "goo": desfoque + limiar de alfa funde formas próximas, criando o
// "pescoço" que liga a gota ao elemento até ela se desprender.
function ensureGooFilter() {
  if (document.getElementById(GOO_FILTER_ID)) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  // Conteúdo estático (nenhum dado do usuário).
  svg.innerHTML = `
    <defs>
      <filter id="${GOO_FILTER_ID}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
        <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="goo" />
        <feMorphology in="goo" operator="dilate" radius="${DROP_OUTLINE_PX}" result="grown" />
        <feFlood flood-color="#fff" result="branco" />
        <feComposite in="branco" in2="grown" operator="in" result="contorno" />
        <feMerge>
          <feMergeNode in="contorno" />
          <feMergeNode in="goo" />
        </feMerge>
      </filter>
    </defs>`;
  document.body.append(svg);
  syncFilterColors();
}

// Para onde a gota escorre: canto superior direito do atalho (ou o espelho, se não
// houver espaço) e ponta direita do título da partição.
// center(rect) devolve o centro final da gota; ox/oy é o deslocamento de partida (dentro do elemento).
function dropGeometry(kind, rect) {
  const roomRight = window.innerWidth - rect.right;
  if (kind === 'topic') {
    const sx = roomRight > 110 ? 1 : -1;
    return {
      ox: -sx * 88,
      oy: 0,
      center: (r) => ({ x: (sx > 0 ? r.right : r.left) + sx * 54, y: r.top + r.height / 2 }),
    };
  }
  const sx = roomRight > 80 ? 1 : -1;
  const headerBottom = $('header').getBoundingClientRect().bottom;
  const sy = rect.top - 80 > headerBottom ? -1 : 1;
  const d = 28; // afastamento diagonal a partir do canto: longe o bastante para a gota se soltar
  return {
    ox: -sx * 60,
    oy: -sy * 60,
    center: (r) => ({ x: (sx > 0 ? r.right : r.left) + sx * d, y: (sy < 0 ? r.top : r.bottom) + sy * d }),
  };
}

// items: [{ label, icon, onClick, danger? }]. A gota com a engrenagem desgruda do
// elemento; tocar nela empilha as ações acima dela.
function openGearMenu({ anchor, shape, kind, items }) {
  closeFloatingMenu(true);
  ensureGooFilter();

  const geometry = dropGeometry(kind, shape.getBoundingClientRect());

  const layer = el('div', 'gota-camada');
  const base = el('div', 'gota-base');
  // A base fica recuada pela espessura do contorno: assim o contorno dela coincide
  // com a borda do próprio elemento (que já está por cima) em vez de engrossá-la.
  base.style.borderRadius = `calc(${getComputedStyle(shape).borderTopLeftRadius} - ${DROP_OUTLINE_PX}px)`;
  const drop = el('div', 'gota');
  drop.style.setProperty('--ox', `${geometry.ox}px`);
  drop.style.setProperty('--oy', `${geometry.oy}px`);
  layer.append(base, drop);

  const ui = el('div', 'gota-ui');
  const gear = el('button', 'gota-engrenagem');
  gear.type = 'button';
  gear.setAttribute('aria-label', 'Ações');
  gear.setAttribute('aria-expanded', 'false');
  gear.append(icon('settings'));

  const list = el('div', 'gota-acoes');
  list.setAttribute('role', 'menu');
  items.forEach((item, index) => {
    const button = el('button', item.danger ? 'gota-acao danger' : 'gota-acao');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.style.setProperty('--i', index);
    button.append(icon(item.icon), el('span', '', item.label));
    button.addEventListener('click', () => {
      closeFloatingMenu();
      item.onClick();
    });
    list.append(button);
  });
  ui.append(gear, list);
  document.body.append(layer, ui);
  anchor.classList.add('gota-origem');

  // As ações ficam acima da engrenagem; se não couberem abaixo do header, descem.
  const headerBottom = $('header').getBoundingClientRect().bottom;
  const startCenter = geometry.center(shape.getBoundingClientRect());
  const above = startCenter.y - DROP_RADIUS - 10 - list.offsetHeight > headerBottom + 8;
  list.classList.add(above ? 'acima' : 'abaixo');

  let frame = null;
  let closed = false;
  let collapseTimer = null;

  // Acompanha o elemento a cada quadro (hover, rolagem, redimensionamento).
  const sync = () => {
    if (!shape.isConnected) {
      close(true);
      return;
    }
    const r = shape.getBoundingClientRect();
    const c = geometry.center(r);
    const originX = r.left - DROP_LAYER_PAD;
    const originY = r.top - DROP_LAYER_PAD;
    setStyles(layer, {
      left: `${originX}px`,
      top: `${originY}px`,
      width: `${r.width + DROP_LAYER_PAD * 2}px`,
      height: `${r.height + DROP_LAYER_PAD * 2}px`,
    });
    const inset = DROP_OUTLINE_PX;
    setStyles(base, {
      left: `${DROP_LAYER_PAD + inset}px`,
      top: `${DROP_LAYER_PAD + inset}px`,
      width: `${r.width - inset * 2}px`,
      height: `${r.height - inset * 2}px`,
    });
    setStyles(drop, { left: `${c.x - originX - DROP_RADIUS}px`, top: `${c.y - originY - DROP_RADIUS}px` });
    setStyles(gear, { left: `${c.x - DROP_RADIUS}px`, top: `${c.y - DROP_RADIUS}px` });

    const w = list.offsetWidth;
    const h = list.offsetHeight;
    setStyles(list, {
      left: `${clamp(c.x - w / 2, EDGE_MARGIN_PX, window.innerWidth - w - EDGE_MARGIN_PX)}px`,
      top: `${above ? c.y - DROP_RADIUS - 10 - h : c.y + DROP_RADIUS + 10}px`,
    });
    frame = requestAnimationFrame(sync);
  };

  const dispose = () => {
    cancelAnimationFrame(frame);
    clearTimeout(collapseTimer);
    layer.remove();
    ui.remove();
  };

  const close = (instant = false) => {
    if (closed) return;
    closed = true;
    if (activeMenu === menu) activeMenu = null;
    anchor.classList.remove('gota-origem');
    if (instant || reducedMotion()) {
      dispose();
      return;
    }
    // A gota volta para dentro do elemento antes de sumir.
    layer.classList.remove('solta');
    layer.classList.add('saindo');
    ui.classList.remove('aberta', 'recolhendo');
    ui.classList.add('saindo');
    setTimeout(dispose, DROP_EXIT_MS);
  };

  gear.addEventListener('click', () => {
    const open = !ui.classList.contains('aberta');
    clearTimeout(collapseTimer);
    ui.classList.toggle('aberta', open);
    ui.classList.toggle('recolhendo', !open);
    gear.setAttribute('aria-expanded', String(open));
    if (open) list.querySelector('button')?.focus({ preventScroll: true });
    else collapseTimer = setTimeout(() => ui.classList.remove('recolhendo'), 220);
  });

  const menu = { anchor, contains: (target) => ui.contains(target), close };
  activeMenu = menu;

  sync();
  void layer.offsetWidth; // aplica a posição inicial antes de soltar a gota
  layer.classList.add('solta');
  ui.classList.add('solta');
}

// ---------- Botão '+' ----------

// Mesma silhueta dos atalhos; no hover/aberto fica redondo e brilhando, e o '+'
// gira até virar '×'. items: [{ label, icon, onClick } | { separator: true }].
// label e icon podem ser funções (lidas a cada abertura, ex.: item de tema).
export function mountFab(items) {
  const fab = el('button', 'fab');
  const face = el('span', 'fab-face');
  face.append(icon('add'));
  fab.append(face);
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Adicionar');
  fab.setAttribute('aria-expanded', 'false');
  fab.addEventListener('click', () => {
    if (activeMenu?.anchor === fab) {
      closeFloatingMenu();
      return;
    }
    openFabMenu(fab, items);
  });
  document.body.append(fab);
}

function openFabMenu(fab, items) {
  closeFloatingMenu(true);

  const menu = el('div', 'fab-menu');
  menu.setAttribute('role', 'menu');
  const actions = items.filter((item) => !item.separator);
  let index = 0;
  for (const item of items) {
    if (item.separator) {
      menu.append(el('div', 'fab-sep'));
      continue;
    }
    const button = el('button', 'fab-item');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    // A torre se monta de baixo (perto do botão) para cima.
    button.style.setProperty('--i', actions.length - 1 - index++);
    const resolve = (value) => (typeof value === 'function' ? value() : value);
    const badge = el('span', 'fab-item-icon');
    badge.append(icon(resolve(item.icon) ?? 'chevron_right'));
    button.append(badge, el('span', 'fab-item-label', resolve(item.label)));
    button.addEventListener('click', () => {
      closeFloatingMenu();
      item.onClick();
    });
    menu.append(button);
  }

  document.body.append(menu);
  fab.classList.add('aberto');
  fab.setAttribute('aria-expanded', 'true');

  activeMenu = {
    anchor: fab,
    contains: (target) => menu.contains(target),
    close(instant) {
      fab.classList.remove('aberto');
      fab.setAttribute('aria-expanded', 'false');
      if (instant) {
        menu.remove();
        return;
      }
      menu.classList.add('saindo');
      removeLater(menu, 280);
    },
  };
}

// ---------- Modais ----------

// tone: 'danger' destaca o ícone em vermelho (confirmações de exclusão).
// onClose: chamado sempre que o modal fecha (salvar, cancelar, Esc, × ou clique fora).
export function openModal({ title, icon: iconName = null, tone = null, content, onClose = null }) {
  closeModal();

  const overlay = el('div', 'modal-overlay');
  const dialog = el('div', tone === 'danger' ? 'modal modal-perigo' : 'modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const head = el('div', 'modal-head');
  if (iconName) {
    const badge = el('span', 'modal-icon');
    badge.append(icon(iconName));
    head.append(badge);
  }
  const heading = el('h2', 'modal-title', title);
  heading.id = `modal-titulo-${Date.now()}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  const closeButton = el('button', 'modal-close');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Fechar');
  closeButton.append(icon('close'));
  closeButton.addEventListener('click', closeModal);
  head.append(heading, closeButton);

  const error = el('p', 'modal-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  dialog.append(head, content);
  // O erro aparece logo acima dos botões de ação.
  const actions = content.querySelector('.modal-actions');
  if (actions) actions.before(error);
  else dialog.append(error);
  overlay.append(dialog);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeModal();
  });

  document.body.append(overlay);
  activeModal = { overlay, close: closeModal, onClose };
  content.querySelector('input:not([type="file"]), select')?.focus();

  return {
    close: closeModal,
    showError(message) {
      error.textContent = message;
      error.hidden = !message;
      if (message && !reducedMotion()) {
        dialog.animate(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-9px)' },
            { transform: 'translateX(7px)' },
            { transform: 'translateX(-4px)' },
            { transform: 'translateX(0)' },
          ],
          { duration: 380, easing: 'ease-out' },
        );
      }
    },
  };
}

function closeModal() {
  if (!activeModal) return;
  const { overlay, onClose } = activeModal;
  activeModal = null;
  overlay.classList.add('saindo');
  removeLater(overlay, 260);
  onClose?.();
}

// Escape: cancela o arraste; senão fecha modal, menu flutuante ou limpa a seleção (nessa ordem).
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (drag?.active) cancelDrag();
  else if (activeModal) activeModal.close();
  else if (activeMenu) closeFloatingMenu();
  else clearSelection();
});

// Clique fora fecha o menu flutuante (exceto no próprio âncora, que faz seu toggle).
document.addEventListener(
  'pointerdown',
  (event) => {
    if (!activeMenu) return;
    if (activeMenu.contains(event.target) || activeMenu.anchor.contains(event.target)) return;
    closeFloatingMenu();
  },
  true,
);

// Executa o submit do modal: erro (string) mantém o modal aberto; null fecha.
async function submitWith(modal, handler) {
  try {
    const error = await handler();
    if (error) modal.showError(error);
    else modal.close();
  } catch (err) {
    console.error(err);
    modal.showError('Ocorreu um erro inesperado.');
  }
}

function labeled(text, control) {
  const label = el('label', 'field');
  label.append(el('span', 'field-label', text), control);
  return label;
}

function textInput(value = '', placeholder = '') {
  const input = el('input', 'field-input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  return input;
}

function actionButton(label, className = 'btn') {
  const button = el('button', className, label);
  button.type = 'button';
  return button;
}

function actionRow(...buttons) {
  const row = el('div', 'modal-actions');
  row.append(...buttons);
  return row;
}

export function openTopicModal({ topic = null, onSubmit }) {
  const form = el('form', 'modal-form');
  const titleInput = textInput(topic?.title ?? '', 'Ex.: Ferramentas');
  titleInput.maxLength = 60;
  titleInput.required = true;

  const cancel = actionButton('Cancelar');
  const save = el('button', 'btn btn-primary', topic ? 'Salvar' : 'Criar');
  save.type = 'submit';
  form.append(labeled('Título', titleInput), actionRow(cancel, save));

  const modal = openModal({
    title: topic ? 'Editar partição' : 'Nova partição',
    icon: topic ? 'edit' : 'create_new_folder',
    content: form,
  });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitWith(modal, () => onSubmit(titleInput.value));
  });
}

// ---------- Seletor de ícone (Material Symbols) ----------

// Lista oficial de nomes do Material Symbols Outlined (≈4300), baixada sob demanda.
const ICON_LIST_URLS = [
  'https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints',
  'https://cdn.jsdelivr.net/gh/google/material-design-icons@master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints',
];
const ICON_RESULTS_MAX = 60;
const ICON_SUGGESTIONS = [
  'home', 'mail', 'search', 'music_note', 'movie', 'sports_esports', 'shopping_cart', 'newspaper',
  'work', 'school', 'code', 'terminal', 'chat', 'photo_camera', 'map', 'cloud',
  'calendar_month', 'account_balance', 'menu_book', 'favorite', 'star', 'rocket_launch', 'palette', 'smart_toy',
];

// Termos em português → palavras dos nomes em inglês (a busca também aceita o nome em inglês).
const ICON_SYNONYMS = {
  casa: ['home', 'house'], inicio: ['home'], email: ['mail'], correio: ['mail'], musica: ['music', 'headphones'],
  video: ['videocam', 'movie', 'play'], filme: ['movie', 'theaters'], serie: ['tv', 'movie'], jogo: ['sports_esports', 'casino'],
  game: ['sports_esports'], banco: ['account_balance'], dinheiro: ['payments', 'attach_money', 'savings'],
  cartao: ['credit_card'], compra: ['shopping', 'cart'], loja: ['store', 'storefront', 'shopping'], noticia: ['newspaper', 'news'],
  jornal: ['newspaper'], trabalho: ['work', 'business'], escola: ['school'], estudo: ['school', 'book'], livro: ['book'],
  leitura: ['book', 'chrome_reader'], foto: ['photo', 'image'], imagem: ['image', 'photo'], camera: ['camera'], mapa: ['map'],
  viagem: ['flight', 'travel', 'luggage'], aviao: ['flight'], carro: ['directions_car'], saude: ['health', 'medical', 'favorite'],
  comida: ['restaurant', 'lunch', 'fastfood'], cafe: ['coffee'], calendario: ['calendar'], agenda: ['calendar', 'event'],
  nuvem: ['cloud'], codigo: ['code'], programacao: ['code', 'terminal'], ferramenta: ['build', 'construction', 'handyman'],
  configuracao: ['settings'], pesquisa: ['search'], busca: ['search'], conversa: ['chat', 'forum'], mensagem: ['chat', 'sms'],
  telefone: ['call', 'phone'], pessoa: ['person'], usuario: ['person', 'account'], grupo: ['group'], estrela: ['star'],
  coracao: ['favorite'], documento: ['description', 'article'], arquivo: ['folder', 'file'], pasta: ['folder'],
  nota: ['note', 'sticky_note'], tarefa: ['task', 'checklist'], relogio: ['schedule', 'alarm'], clima: ['sunny', 'cloud', 'weather'],
  esporte: ['sports'], futebol: ['sports_soccer'], radio: ['radio'], televisao: ['tv'], seguranca: ['security', 'shield', 'lock'],
  senha: ['password', 'key'], rede: ['wifi', 'lan', 'hub'], arte: ['palette', 'brush'], desenho: ['draw', 'brush'],
  robo: ['smart_toy', 'robot'], ia: ['smart_toy', 'psychology', 'auto_awesome'], ciencia: ['science'], mundo: ['public', 'language'],
  globo: ['public'], idioma: ['translate', 'language'], traducao: ['translate'], baixar: ['download'],
  foguete: ['rocket'], planta: ['eco', 'park'], animal: ['pets'], cachorro: ['pets'], gato: ['pets'],
};

let iconListPromise = null;

// Promise<Set<string>> com todos os nomes; rejeita se nenhuma fonte responder.
function loadIconNames() {
  if (!iconListPromise) {
    iconListPromise = (async () => {
      for (const url of ICON_LIST_URLS) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          const names = (await response.text()).split('\n').map((line) => line.split(' ')[0].trim()).filter(Boolean);
          if (names.length) return new Set(names);
        } catch (err) {
          console.warn('UtiliT: falha ao baixar a lista de ícones de', url, err);
        }
      }
      throw new Error('Lista de ícones indisponível.');
    })();
    iconListPromise.catch(() => { iconListPromise = null; }); // permite tentar de novo depois
  }
  return iconListPromise;
}

const stripAccents = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Nomes que combinam com a busca: exato > começa com > contém; sinônimos em português ajudam.
function searchIcons(names, rawQuery) {
  const query = stripAccents(String(rawQuery).trim().toLowerCase());
  if (!query) return ICON_SUGGESTIONS.filter((name) => names.has(name));
  const terms = new Set();
  for (const word of query.split(/[\s_-]+/).filter(Boolean)) {
    terms.add(word);
    if (word.length < 3) continue;
    for (const [key, values] of Object.entries(ICON_SYNONYMS)) {
      if (key.startsWith(word) || word.startsWith(key)) values.forEach((v) => terms.add(v));
    }
  }
  const joined = query.replace(/[\s-]+/g, '_');
  const scored = [];
  for (const name of names) {
    let score = 0;
    if (name === joined) score = 100;
    else if (name.startsWith(joined)) score = 60;
    else if (name.includes(joined)) score = 40;
    for (const term of terms) {
      if (name === term) score = Math.max(score, 90);
      else if (name.startsWith(term)) score = Math.max(score, 50);
      else if (name.includes(term)) score = Math.max(score, 20);
    }
    if (score) scored.push([score, name]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]));
  return scored.slice(0, ICON_RESULTS_MAX).map(([, name]) => name);
}

const BRAND_RESULTS_MAX = 24;
const SYMBOL_RESULTS_MAX = 36;

// Marcas do thesvg que combinam com a busca (slug, nome ou alias).
function searchBrands(index, rawQuery) {
  const query = stripAccents(String(rawQuery).trim().toLowerCase());
  if (!query) return [];
  const slugQuery = query.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const scored = [];
  for (const brand of index.list) {
    const title = stripAccents(brand.title.toLowerCase());
    let score = 0;
    if (brand.slug === slugQuery || title === query) score = 100;
    else if (brand.slug.startsWith(slugQuery) || title.startsWith(query)) score = 60;
    else if (brand.aliases.some((a) => a.startsWith(query))) score = 45;
    else if (brand.slug.includes(slugQuery) || title.includes(query)) score = 25;
    if (score && brand.slug.endsWith('-badge')) score -= 5;
    if (score) scored.push([score, brand]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].slug.length - b[1].slug.length || a[1].slug.localeCompare(b[1].slug));
  return scored.slice(0, BRAND_RESULTS_MAX).map(([, brand]) => brand);
}

// Campo "Ícone" do modal de atalho: automático (marca do thesvg pelo domínio, ou favicon),
// marca escolhida à mão ou Material Symbol. getUrl() devolve o endereço digitado.
// Devolve { node, value(), refreshPreview() }; value() = { icon, brand } para storage.saveSite
// (brand undefined = resolver automaticamente ao salvar).
function createIconPicker(site, getUrl) {
  const field = el('div', 'field');
  const fieldLabel = el('label', 'field-label', 'Ícone');
  const row = el('div', 'icone-linha');
  const preview = el('span', 'icone-previa');
  preview.setAttribute('aria-hidden', 'true');
  const input = textInput('', 'Buscar marca ou ícone: spotify, casa, música…');
  input.id = `icone-busca-${Date.now()}`;
  input.type = 'search';
  fieldLabel.htmlFor = input.id;
  const autoButton = actionButton('Automático', 'btn icone-limpar');
  const status = el('p', 'icone-status');
  status.id = `${input.id}-status`;
  status.setAttribute('aria-live', 'polite');
  input.setAttribute('aria-describedby', status.id);
  row.append(preview, input, autoButton);

  const section = (title) => {
    const wrap = el('div', 'icone-secao');
    const grid = el('div', 'icone-grid');
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', title);
    wrap.append(el('span', 'icone-secao-titulo', title), grid);
    return { wrap, grid };
  };
  const brands = section('Marcas');
  const symbols = section('Ícones');
  field.append(fieldLabel, row, status, brands.wrap, symbols.wrap);

  // Escolha atual: { kind: 'auto' } | { kind: 'brand', slug } | { kind: 'icon', name }.
  let choice = site?.icon ? { kind: 'icon', name: site.icon } : site?.brand ? { kind: 'brand', slug: site.brand } : { kind: 'auto' };
  // Marca salva igual à que o domínio daria = estava no automático.
  let checkAutoBrand = choice.kind === 'brand';
  let brandIndex = null;
  let brandFailed = false;
  let symbolNames = null;
  let symbolsFailed = false;

  const autoSlug = () => (brandIndex ? matchBrand(brandIndex, normalizeUrl(getUrl())) : null);
  const brandTitle = (slug) => brandIndex?.list.find((b) => b.slug === slug)?.title ?? slug;

  const refreshPreview = () => {
    const url = normalizeUrl(getUrl());
    let node;
    if (choice.kind === 'icon') node = icon(choice.name);
    else if (choice.kind === 'brand') node = brandIcon(choice.slug, url ?? '');
    else if (autoSlug()) node = brandIcon(autoSlug(), url);
    else node = url ? faviconImage(url) : icon('link');
    preview.replaceChildren(node);
    autoButton.hidden = choice.kind === 'auto';

    if (choice.kind === 'icon') status.textContent = `Ícone escolhido: ${choice.name}`;
    else if (choice.kind === 'brand') status.textContent = `Marca escolhida: ${brandTitle(choice.slug)}`;
    else if (!url) status.textContent = 'Automático: informe o endereço para buscar a marca do site.';
    else if (!brandIndex && !brandFailed) status.textContent = 'Automático: procurando a marca do site…';
    else if (autoSlug()) status.textContent = `Automático: marca ${brandTitle(autoSlug())} (thesvg.org).`;
    else status.textContent = brandFailed
      ? 'Automático: thesvg.org indisponível agora; usando o favicon do site.'
      : 'Automático: nenhuma marca encontrada; usando o favicon do site.';
  };

  const option = (label, active, content, onPick) => {
    const button = el('button', active ? 'icone-opcao ativo' : 'icone-opcao');
    button.type = 'button';
    button.title = label;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-selected', String(active));
    button.append(content);
    button.addEventListener('click', () => {
      onPick();
      update();
    });
    return button;
  };

  const renderResults = () => {
    const query = input.value;
    // Marcas: resultados da busca; sem busca, a marca escolhida/automática.
    let brandList = [];
    if (brandIndex) {
      brandList = searchBrands(brandIndex, query);
      const current = choice.kind === 'brand' ? choice.slug : choice.kind === 'auto' ? autoSlug() : null;
      if (current && !brandList.some((b) => b.slug === current)) {
        const found = brandIndex.list.find((b) => b.slug === current);
        if (found && !query.trim()) brandList.unshift(found);
      }
    }
    brands.grid.replaceChildren(
      ...brandList.map((brand) => {
        const thumb = el('img', 'icone-marca-mini');
        thumb.src = brandSvgUrl(brand.slug, brand.variants.includes('mono') ? 'mono' : 'default');
        thumb.alt = '';
        thumb.loading = 'lazy';
        thumb.draggable = false;
        const active = choice.kind === 'brand' && choice.slug === brand.slug;
        return option(brand.title, active, thumb, () => { choice = { kind: 'brand', slug: brand.slug }; });
      }),
    );
    brands.wrap.hidden = !brandList.length;

    // Ícones (Material Symbols): busca; sem busca, sugestões. Sem a lista, aceita o nome exato.
    let names = [];
    if (symbolNames) names = searchIcons(symbolNames, query).slice(0, SYMBOL_RESULTS_MAX);
    else if (symbolsFailed && normalizeIconName(query)) names = [normalizeIconName(query)];
    if (choice.kind === 'icon' && !query.trim() && !names.includes(choice.name)) names.unshift(choice.name);
    symbols.grid.replaceChildren(
      ...names.map((name) =>
        option(name.replace(/_/g, ' '), choice.kind === 'icon' && choice.name === name, icon(name), () => {
          choice = { kind: 'icon', name };
        }),
      ),
    );
    symbols.wrap.hidden = !names.length;
  };

  const update = () => {
    refreshPreview();
    renderResults();
  };

  input.addEventListener('input', renderResults);
  // Enter na busca não envia o formulário.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  autoButton.addEventListener('click', () => {
    choice = { kind: 'auto' };
    update();
  });

  loadBrandIndex()
    .then((index) => {
      brandIndex = index;
      if (checkAutoBrand && choice.kind === 'brand' && autoSlug() === choice.slug) choice = { kind: 'auto' };
    })
    .catch((err) => {
      console.warn('UtiliT: manifesto do thesvg indisponível.', err);
      brandFailed = true;
    })
    .finally(() => {
      checkAutoBrand = false;
      update();
    });
  loadIconNames()
    .then((set) => { symbolNames = set; })
    .catch(() => { symbolsFailed = true; })
    .finally(renderResults);
  update();

  return {
    node: field,
    refreshPreview: update,
    value() {
      if (choice.kind === 'icon') return { icon: choice.name, brand: undefined };
      if (choice.kind === 'brand') return { icon: '', brand: choice.slug };
      return { icon: '', brand: undefined };
    },
  };
}

// onSubmit({ name, url, topicId, icon, brand }) — topicId null = sem partição. Nome opcional.
// icon vazio + brand undefined = ícone automático (marca do thesvg pelo domínio, ou favicon).
export function openSiteModal({ site = null, topicId = null, topics, onSubmit }) {
  const form = el('form', 'modal-form');
  const nameInput = textInput(site?.name ?? '', 'YouTube; Instagram; [...]');
  const urlInput = textInput(site?.url ?? '', 'https://exemplo.com');
  urlInput.required = true;
  urlInput.inputMode = 'url';

  const select = el('select', 'field-input');
  select.append(new Option('Nenhuma', ''));
  for (const t of topics) select.append(new Option(t.title, t.id));
  select.value = topicId ?? '';

  const iconPicker = createIconPicker(site, () => urlInput.value);
  urlInput.addEventListener('change', iconPicker.refreshPreview);

  const cancel = actionButton('Cancelar');
  const save = el('button', 'btn btn-primary', site ? 'Salvar' : 'Adicionar');
  save.type = 'submit';
  form.append(
    labeled('Nome', nameInput),
    labeled('Endereço', urlInput),
    labeled('Partição', select),
    iconPicker.node,
    actionRow(cancel, save),
  );

  const modal = openModal({
    title: site ? 'Editar atalho' : 'Novo atalho',
    icon: site ? 'edit' : 'add_link',
    content: form,
  });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitWith(modal, () =>
      onSubmit({ name: nameInput.value, url: urlInput.value, topicId: select.value || null, ...iconPicker.value() }),
    );
  });
}

// Confirmação genérica. checkbox = { label, checked } opcional; onConfirm recebe o valor dele.
export function openConfirmModal({ title, message, confirmLabel = 'Confirmar', danger = false, checkbox = null, onConfirm }) {
  const form = el('form', 'modal-form');
  form.append(el('p', 'modal-text', message));

  let checkInput = null;
  if (checkbox) {
    checkInput = el('input');
    checkInput.type = 'checkbox';
    checkInput.checked = checkbox.checked;
    const label = el('label', 'checkbox-field');
    label.append(checkInput, el('span', '', checkbox.label));
    form.append(label);
  }

  const cancel = actionButton('Cancelar');
  const confirm = el('button', danger ? 'btn btn-danger' : 'btn btn-primary', confirmLabel);
  confirm.type = 'submit';
  form.append(actionRow(cancel, confirm));

  const modal = openModal({
    title,
    icon: danger ? 'delete' : 'help',
    tone: danger ? 'danger' : null,
    content: form,
  });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    modal.close();
    onConfirm(checkInput ? checkInput.checked : undefined);
  });
}

// onFile(file) pode ser assíncrono; devolve mensagem de erro (string) ou null.
export function openImportModal({ onFile }) {
  const form = el('form', 'modal-form');
  const fileInput = el('input');
  fileInput.type = 'file';
  // .txt: backups compartilhados (mesmo conteúdo JSON, validado igual).
  fileInput.accept = '.json,.txt,application/json,text/plain';

  // Área de upload: o input cobre a área inteira (invisível), então clicar ou
  // soltar um arquivo sobre ela funciona nativamente.
  const DEFAULT_TITLE = 'Clique para escolher ou arraste o arquivo aqui';
  const DEFAULT_HINT = 'Backup do UtiliT em formato .json ou .txt';
  const zone = el('label', 'dropzone');
  const zoneIcon = icon('upload_file');
  zoneIcon.classList.add('dropzone-icon');
  const zoneTitle = el('span', 'dropzone-title', DEFAULT_TITLE);
  const zoneHint = el('span', 'dropzone-hint', DEFAULT_HINT);
  zone.append(fileInput, zoneIcon, zoneTitle, zoneHint);
  ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, () => zone.classList.add('sobre')));
  ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, () => zone.classList.remove('sobre')));

  const cancel = actionButton('Cancelar');
  const save = el('button', 'btn btn-primary', 'Importar');
  save.type = 'submit';
  form.append(zone, actionRow(cancel, save));

  const modal = openModal({ title: 'Importar backup', icon: 'upload_file', content: form });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    zone.classList.toggle('com-arquivo', Boolean(file));
    zoneIcon.textContent = file ? 'description' : 'upload_file';
    zoneTitle.textContent = file ? file.name : DEFAULT_TITLE;
    zoneHint.textContent = file ? `${(file.size / 1024).toFixed(1)} KB · clique para trocar` : DEFAULT_HINT;
    modal.showError('');
  });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitWith(modal, () => {
      const file = fileInput.files?.[0];
      if (!file) return 'Selecione um arquivo .json ou .txt.';
      return onFile(file);
    });
  });
}

// Reserva quando o navegador não compartilha arquivos: o backup já foi baixado e
// os botões abrem WhatsApp Web / Gmail com o texto pronto, para anexar à mão.
// failed = o navegador suporta, mas o compartilhamento deu erro.
export function openShareFallbackModal({ links, failed = false }) {
  const form = el('form', 'modal-form');
  const reason = failed
    ? 'Não foi possível abrir o compartilhamento.'
    : 'Este navegador não permite compartilhar arquivos diretamente.';
  form.append(
    el('p', 'modal-text', `${reason} O arquivo utilit-backup.json foi baixado: abra um dos apps abaixo e anexe-o à mensagem.`),
  );

  const linkButton = (label, iconName, href) => {
    const link = el('a', 'btn btn-link');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(icon(iconName), el('span', '', label));
    return link;
  };
  const apps = el('div', 'share-apps');
  apps.append(linkButton('Abrir WhatsApp Web', 'chat', links.whatsapp), linkButton('Abrir Gmail', 'mail', links.gmail));

  const close = el('button', 'btn btn-primary', 'Fechar');
  close.type = 'submit';
  form.append(apps, actionRow(close));

  const modal = openModal({ title: 'Compartilhar backup', icon: 'share', content: form });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    modal.close();
  });
}

// onSubmit(targetTopicId) devolve mensagem de erro (string) ou null.
export function openMoveModal({ topic, targets, onSubmit }) {
  const form = el('form', 'modal-form');
  const select = el('select', 'field-input');
  select.append(new Option('Sem partição (órfãos)', ''));
  for (const t of targets) select.append(new Option(t.title, t.id));

  const cancel = actionButton('Cancelar');
  const save = el('button', 'btn btn-primary', 'Mover');
  save.type = 'submit';
  form.append(
    el('p', 'modal-text', `Mover todos os atalhos de "${topic.title}" para:`),
    labeled('Partição de destino', select),
    actionRow(cancel, save),
  );

  const modal = openModal({ title: 'Mover atalhos', icon: 'drive_file_move', content: form });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitWith(modal, () => onSubmit(select.value || null));
  });
}

// ---------- Temas (modo + cor de destaque) ----------

const THEME_MODES = [
  { value: 'dark', label: 'Escuro', icon: 'dark_mode' },
  { value: 'light', label: 'Claro', icon: 'light_mode' },
  { value: 'system', label: 'Sistema', icon: 'brightness_auto' },
];
const HEX_ERROR = 'Cor inválida. Use o formato #RGB ou #RRGGBB.';

function fieldGroup(text, control) {
  const group = el('div', 'field');
  group.append(el('span', 'field-label', text), control);
  return group;
}

// Cor "Padrão" do modo exibido (branco no escuro, grafite no claro), para o seletor nativo.
const defaultAccentHex = () =>
  normalizeHex(getComputedStyle(document.documentElement).getPropertyValue('--accent-default')) ?? '#ffffff';

// Pré-visualização ao vivo: cada mudança chama onPreview(draft, { check, animate }), que aplica
// a aparência e devolve o modo efetivamente usado (pode trocar se a cor ficar ilegível).
// check = conferir o contraste e trocar o modo se preciso.
// draft = { mode: 'dark' | 'light' | 'system', accent: '#rrggbb' | null }.
// onSubmit(draft) devolve erro (string) ou null; onCancel() desfaz a pré-visualização.
export function openThemeModal({ palette, initial, onPreview, onSubmit, onCancel }) {
  const draft = { ...initial };
  let saved = false;
  const form = el('form', 'modal-form');

  // Modo: controle segmentado.
  const segmented = el('div', 'segmentado');
  segmented.setAttribute('role', 'radiogroup');
  segmented.setAttribute('aria-label', 'Modo');
  const modeButtons = THEME_MODES.map((mode) => {
    const button = el('button', 'segmento');
    button.type = 'button';
    button.dataset.value = mode.value;
    button.setAttribute('role', 'radio');
    button.append(icon(mode.icon), el('span', '', mode.label));
    button.addEventListener('click', () => {
      draft.mode = mode.value;
      preview({ check: false });
    });
    segmented.append(button);
    return button;
  });

  // Cor: grade com as cores padrão.
  const swatches = el('div', 'swatches');
  swatches.setAttribute('role', 'radiogroup');
  swatches.setAttribute('aria-label', 'Cor de destaque');
  const swatchButtons = palette.map((color) => {
    const button = el('button', color.hex ? 'swatch' : 'swatch swatch-padrao');
    button.type = 'button';
    button.title = color.name;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', color.name);
    if (color.hex) button.style.setProperty('--swatch', color.hex);
    button.append(icon('check'));
    button.addEventListener('click', () => {
      modal.showError('');
      setAccent(color.hex, { check: true });
    });
    swatches.append(button);
    return { button, hex: color.hex };
  });

  // Hexadecimal: amostra (seletor nativo) + campo de texto, sincronizados.
  const native = el('input', 'hex-nativo');
  native.type = 'color';
  native.setAttribute('aria-label', 'Escolher cor no seletor do navegador');
  const hexInput = textInput('', '#RRGGBB');
  hexInput.classList.add('hex-input');
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  hexInput.setAttribute('aria-label', 'Cor em hexadecimal');
  const hexRow = el('div', 'hex-row');
  hexRow.append(native, hexInput);

  const cancel = actionButton('Cancelar');
  const save = el('button', 'btn btn-primary', 'Salvar');
  save.type = 'submit';
  form.append(fieldGroup('Modo', segmented), fieldGroup('Cor', swatches), fieldGroup('Hexadecimal', hexRow), actionRow(cancel, save));

  function syncControls({ keepHexText = false } = {}) {
    for (const button of modeButtons) {
      const on = button.dataset.value === draft.mode;
      button.classList.toggle('ativo', on);
      button.setAttribute('aria-checked', String(on));
    }
    for (const { button, hex } of swatchButtons) {
      const on = hex === draft.accent;
      button.classList.toggle('ativo', on);
      button.setAttribute('aria-checked', String(on));
    }
    if (!keepHexText) hexInput.value = draft.accent ?? '';
    native.value = draft.accent ?? defaultAccentHex();
  }

  function preview({ check, animate = true, keepHexText = false }) {
    draft.mode = onPreview({ ...draft }, { check, animate }) ?? draft.mode;
    syncControls({ keepHexText });
  }

  function setAccent(hex, options) {
    draft.accent = hex;
    preview(options);
  }

  const modal = openModal({
    title: 'Temas',
    icon: 'palette',
    content: form,
    onClose: () => {
      if (!saved) onCancel();
    },
  });
  syncControls();
  modeButtons.find((button) => button.classList.contains('ativo'))?.focus();

  // Digitando: aplica ao completar 6 dígitos (3 dígitos só ao confirmar, para não
  // pré-visualizar "#fff" a caminho de "#fff000").
  hexInput.addEventListener('input', () => {
    modal.showError('');
    const digits = hexInput.value.trim().replace(/^#/, '');
    const hex = digits.length === 6 ? normalizeHex(digits) : null;
    if (hex && hex !== draft.accent) setAccent(hex, { check: true, keepHexText: true });
  });
  hexInput.addEventListener('change', () => {
    const text = hexInput.value.trim();
    if (!text) return setAccent(null, { check: true });
    const hex = normalizeHex(text);
    if (!hex) return modal.showError(HEX_ERROR);
    setAccent(hex, { check: true });
  });
  // Seletor nativo: enquanto arrasta só pré-visualiza (sem trocar de modo); ao fechar, confere.
  native.addEventListener('input', () => {
    modal.showError('');
    setAccent(native.value, { check: false, animate: false });
  });
  native.addEventListener('change', () => setAccent(native.value, { check: true }));

  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = hexInput.value.trim();
    const hex = text ? normalizeHex(text) : null;
    if (text && !hex) return modal.showError(HEX_ERROR);
    if (hex !== draft.accent) setAccent(hex, { check: true });
    submitWith(modal, () => {
      const error = onSubmit({ ...draft });
      if (!error) saved = true;
      return error;
    });
  });
}

// ---------- Navegação do header ----------

const NAV_THUMB_MIN_PX = 40;
const NAV_ARROW_ZONE_PX = 56; // itens sob a seta (área com fade) contam como ocultos
const NAV_SPY_OFFSET_PX = 32;

let nav = null;        // ul.nav-links
let navShell = null;
let navBar = null;
let navThumb = null;
let navArrowLeft = null;
let navArrowRight = null;
let navOver = false;   // cursor sobre a trilha
let navDrag = null;    // { startX, startScroll } durante o arraste do polegar
let navTarget = null;  // destino da rolagem suave
let navFrame = null;
let activeNavId = null;

function navMax() {
  return Math.max(0, nav.scrollWidth - nav.clientWidth);
}

// Rolagem suave própria (setas, roda do mouse e partição ativa) com desaceleração.
function navScrollTo(left) {
  navTarget = clamp(left, 0, navMax());
  if (reducedMotion()) {
    nav.scrollLeft = navTarget;
    navTarget = null;
    return;
  }
  if (navFrame === null) navFrame = requestAnimationFrame(navStep);
}

function navStep() {
  navFrame = null;
  if (navTarget === null) return;
  const diff = navTarget - nav.scrollLeft;
  if (Math.abs(diff) < 1) {
    nav.scrollLeft = navTarget;
    navTarget = null;
    return;
  }
  const before = nav.scrollLeft;
  const step = diff * 0.2;
  nav.scrollLeft += Math.abs(step) < 1 ? Math.sign(diff) : step;
  if (nav.scrollLeft === before) {
    navTarget = null; // chegou ao limite
    return;
  }
  navFrame = requestAnimationFrame(navStep);
}

function stopNavScroll() {
  cancelAnimationFrame(navFrame);
  navFrame = null;
  navTarget = null;
}

// Fades e setas nas pontas, contador de partições ocultas de cada lado e barra de rolagem.
function updateNav() {
  if (!navShell) return;
  const max = navMax();
  const canLeft = nav.scrollLeft > 1;
  const canRight = nav.scrollLeft < max - 1;
  navShell.classList.toggle('pode-esquerda', canLeft);
  navShell.classList.toggle('pode-direita', canRight);

  const box = nav.getBoundingClientRect();
  let hiddenLeft = 0;
  let hiddenRight = 0;
  for (const item of nav.children) {
    const r = item.getBoundingClientRect();
    if (canLeft && r.left < box.left + NAV_ARROW_ZONE_PX) hiddenLeft++;
    else if (canRight && r.right > box.right - NAV_ARROW_ZONE_PX) hiddenRight++;
  }
  setArrowCount(navArrowLeft, hiddenLeft, 'anterior', 'anteriores');
  setArrowCount(navArrowRight, hiddenRight, 'oculta à direita', 'ocultas à direita');

  navBar.style.display = max > 0 ? '' : 'none';
  if (max > 0) {
    const trackW = navBar.clientWidth;
    const thumbW = Math.max(NAV_THUMB_MIN_PX, trackW * (nav.clientWidth / nav.scrollWidth));
    const offset = (nav.scrollLeft / max) * (trackW - thumbW);
    setStyles(navThumb, { width: `${thumbW}px`, transform: `translateX(${offset}px)` });
  }
}

function setArrowCount(arrow, count, singular, plural) {
  arrow.querySelector('.nav-badge').textContent = count ? String(count) : '';
  arrow.title = count ? `${count} partição${count > 1 ? 'ões' : ''} ${count > 1 ? plural : singular}` : '';
}

function setNavBarVisible() {
  navBar.classList.toggle('visible', navOver || navDrag !== null);
}

// Destaca no header a partição que está no topo da tela e a mantém visível na trilha.
function updateActiveNav() {
  if (!navShell) return;
  const line = $('header').getBoundingClientRect().bottom + NAV_SPY_OFFSET_PX;
  let current = null;
  for (const section of document.querySelectorAll('#app section.divisao:not(.orfaos)')) {
    if (section.getBoundingClientRect().top <= line) current = section.id;
    else break;
  }
  if (current === activeNavId) return;
  activeNavId = current;

  let activeItem = null;
  for (const item of nav.children) {
    const isActive = current !== null && item.firstElementChild?.getAttribute('href') === `#${current}`;
    item.classList.toggle('ativo', isActive);
    if (isActive) activeItem = item;
  }
  if (!activeItem || navOver || navDrag) return;
  const box = nav.getBoundingClientRect();
  const r = activeItem.getBoundingClientRect();
  if (r.left < box.left + NAV_ARROW_ZONE_PX || r.right > box.right - NAV_ARROW_ZONE_PX) {
    navScrollTo(activeItem.offsetLeft - (nav.clientWidth - activeItem.offsetWidth) / 2);
  }
}

export function mountNav() {
  nav = $('.nav-links');
  navShell = $('.nav-shell');
  navArrowLeft = $('.nav-arrow-esquerda', navShell);
  navArrowRight = $('.nav-arrow-direita', navShell);
  navBar = el('div', 'nav-scrollbar');
  navThumb = el('div', 'nav-scrollbar-thumb');
  navBar.append(navThumb);
  navShell.append(navBar);

  navShell.addEventListener('pointerenter', () => { navOver = true; setNavBarVisible(); });
  navShell.addEventListener('pointerleave', () => { navOver = false; setNavBarVisible(); });
  nav.addEventListener('scroll', updateNav, { passive: true });
  window.addEventListener('resize', updateNav);
  document.fonts?.ready.then(updateNav);

  for (const arrow of [navArrowLeft, navArrowRight]) {
    arrow.addEventListener('click', () => {
      const from = navTarget ?? nav.scrollLeft;
      navScrollTo(from + Number(arrow.dataset.dir) * nav.clientWidth * 0.75);
    });
  }

  // Roda vertical do mouse rola a trilha na horizontal.
  nav.addEventListener(
    'wheel',
    (event) => {
      if (navMax() <= 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY;
      navScrollTo((navTarget ?? nav.scrollLeft) + delta);
    },
    { passive: false },
  );

  navThumb.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    stopNavScroll();
    navDrag = { startX: event.clientX, startScroll: nav.scrollLeft };
    navThumb.setPointerCapture(event.pointerId);
    setNavBarVisible();
  });
  navThumb.addEventListener('pointermove', (event) => {
    if (!navDrag) return;
    const trackW = navBar.clientWidth;
    const thumbW = navThumb.offsetWidth;
    const span = trackW - thumbW;
    if (span <= 0) return;
    nav.scrollLeft = navDrag.startScroll + (event.clientX - navDrag.startX) * (navMax() / span);
  });
  const endDrag = () => {
    navDrag = null;
    setNavBarVisible();
  };
  navThumb.addEventListener('pointerup', endDrag);
  navThumb.addEventListener('pointercancel', endDrag);

  let spyFrame = null;
  window.addEventListener(
    'scroll',
    () => {
      if (spyFrame !== null) return;
      spyFrame = requestAnimationFrame(() => {
        spyFrame = null;
        updateActiveNav();
      });
    },
    { passive: true },
  );

  updateNav();
  updateActiveNav();
}

// ---------- Seleção múltipla e arrastar/soltar (somente mouse) ----------

const AUTOSCROLL_EDGE_PX = 60;
const AUTOSCROLL_STEP_PX = 18;

const selection = { kind: null, ids: new Set() }; // kind: 'site' | 'topic'
let dragHandlers = null; // { onDropSites({ siteIds, topicId, beforeSiteId }), onDropTopics({ topicIds, beforeTopicId }) }
let drag = null;         // arraste em andamento (ativo só após mover mais que a tolerância)
let suppressClick = false;
let trash = null;        // botão da lixeira flutuante
let scrollFrame = null;

const isMulti = (event) => event.ctrlKey || event.metaKey;

// Item arrastável sob o alvo: atalho ou título de partição (a seção de órfãos não tem título).
function dragItemAt(target) {
  if (!(target instanceof Element) || !target.closest('#app')) return null;
  const site = target.closest('.site');
  if (site) return { kind: 'site', id: site.dataset.siteId };
  const section = target.closest('.nome-topico')?.closest('section.divisao');
  if (section && !section.classList.contains('orfaos')) return { kind: 'topic', id: section.id };
  return null;
}

// Elemento que recebe o destaque de seleção (atalho ou título da partição).
function itemElement(kind, id) {
  const app = $('#app');
  if (kind === 'site') return app.querySelector(`.site[data-site-id="${CSS.escape(id)}"]`);
  return app.querySelector(`section[id="${CSS.escape(id)}"] .nome-topico`);
}

// Elemento que fica esmaecido enquanto é arrastado (atalho ou a partição inteira).
function draggedElement(kind, id) {
  const node = itemElement(kind, id);
  return kind === 'topic' ? node?.closest('section') : node;
}

function inDomOrder(kind, ids) {
  const selector = kind === 'site' ? '#app .site' : '#app section.divisao:not(.orfaos)';
  return [...document.querySelectorAll(selector)]
    .map((node) => (kind === 'site' ? node.dataset.siteId : node.id))
    .filter((id) => ids.has(id));
}

function clearSelection() {
  for (const id of selection.ids) itemElement(selection.kind, id)?.classList.remove('selecionado');
  selection.kind = null;
  selection.ids.clear();
  updateTrash();
}

// Lixeira flutuante: aparece (fade) enquanto há itens selecionados; clicar pede exclusão.
function updateTrash() {
  trash?.classList.toggle('visivel', selection.ids.size > 0);
}

function mountTrash() {
  trash = el('button', 'lixeira-flutuante');
  trash.type = 'button';
  trash.setAttribute('aria-label', 'Excluir selecionados');
  trash.append(icon('delete'));
  trash.addEventListener('click', () => {
    if (!selection.ids.size) return;
    const kind = selection.kind;
    const ids = inDomOrder(kind, selection.ids);
    dragHandlers.onDeleteSelection({ kind, ids });
  });
  document.body.append(trash);
}

function toggleSelection(kind, id) {
  if (selection.kind !== kind) clearSelection();
  selection.kind = kind;
  const node = itemElement(kind, id);
  if (selection.ids.delete(id)) {
    node?.classList.remove('selecionado');
  } else {
    selection.ids.add(id);
    node?.classList.add('selecionado');
  }
  if (selection.ids.size === 0) selection.kind = null;
  updateTrash();
}

// Chamado a cada renderização: o DOM é refeito, então seleção e arraste são descartados.
function resetDragAndSelection() {
  finishDrag();
  selection.kind = null;
  selection.ids.clear();
  updateTrash();
}

export function mountDragAndDrop(handlers) {
  dragHandlers = handlers; // + onDeleteSelection({ kind, ids })
  mountTrash();
  document.addEventListener('pointerdown', onDragPointerDown, true);
  document.addEventListener('click', onSelectionClick, true);
  document.addEventListener('dragstart', (event) => {
    if (event.target instanceof Element && event.target.closest('#app')) event.preventDefault();
  });
}

function onDragPointerDown(event) {
  if (event.button !== 0 || event.pointerType !== 'mouse') return;
  finishDrag();
  if (event.target instanceof Element && event.target.closest('.lixeira-flutuante')) return; // não limpa a seleção

  const item = dragItemAt(event.target);
  if (!item) {
    if (!isMulti(event)) clearSelection();
    return;
  }

  const selected = selection.kind === item.kind && selection.ids.has(item.id);
  if (isMulti(event) && !selected) return; // Ctrl+clique só alterna a seleção (no click)
  if (!selected) clearSelection();         // arrastar item fora da seleção leva só ele

  drag = {
    kind: item.kind,
    ids: selected ? inDomOrder(item.kind, selection.ids) : [item.id],
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    active: false,
    drop: null,
    scrollStep: 0,
    ghost: null,
    indicator: null,
    zone: null,
    highlight: null,
  };
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', finishDrag);
  window.addEventListener('scroll', onDragScroll, { passive: true });
}

function onDragMove(event) {
  if (!drag) return;
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (!drag.active) {
    if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) <= MOVE_TOLERANCE_PX) return;
    startDrag();
  }
  moveGhost();
  updateDropTarget();
  updateAutoScroll();
}

function startDrag() {
  drag.active = true;
  closeFloatingMenu();
  document.body.classList.add('arrastando-ativo');

  drag.ghost = el('div', 'arraste-fantasma', ghostLabel());
  drag.indicator = el('div', 'arraste-indicador');
  document.body.append(drag.ghost, drag.indicator);

  if (drag.kind === 'site') {
    drag.zone = el('div', 'zona-orfaos', 'Solte aqui para deixar sem partição');
    document.body.append(drag.zone);
  }
  for (const id of drag.ids) draggedElement(drag.kind, id)?.classList.add('arrastando');
}

function ghostLabel() {
  if (drag.ids.length > 1) return `${drag.ids.length} ${drag.kind === 'site' ? 'atalhos' : 'partições'}`;
  const node = itemElement(drag.kind, drag.ids[0]);
  return node?.querySelector('.site-name, h1')?.textContent ?? '';
}

function moveGhost() {
  drag.ghost.style.transform = `translate(${drag.x + 14}px, ${drag.y + 14}px)`;
}

function clearDropVisuals() {
  drag.highlight?.classList.remove('drop-alvo');
  drag.highlight = null;
  drag.zone?.classList.remove('drop-alvo');
  drag.indicator.style.display = 'none';
}

function showIndicator({ left, top, width, height }) {
  setStyles(drag.indicator, {
    display: 'block',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
}

function updateDropTarget() {
  clearDropVisuals();
  const under = document.elementFromPoint(drag.x, drag.y); // fantasma/indicador ignoram ponteiro
  drag.drop = drag.kind === 'site' ? findSiteDrop(under) : findTopicDrop(under);
}

// Destino de atalhos: faixa de órfãos, ou uma partição/órfãos com posição entre os atalhos.
function findSiteDrop(under) {
  const zone = under?.closest('.zona-orfaos');
  if (zone) {
    zone.classList.add('drop-alvo');
    return { overZone: true, topicId: null, beforeSiteId: null };
  }
  const section = under?.closest('#app section.divisao');
  if (!section) return null;

  const children = [...section.querySelector('.sites-grid').children];
  const rects = children.map((child) => child.getBoundingClientRect());
  // Posição de inserção na linha sob o cursor: antes do primeiro atalho cujo centro está à direita.
  const row = rects.map((r, i) => (drag.y >= r.top && drag.y <= r.bottom ? i : -1)).filter((i) => i >= 0);
  let index = children.length;
  if (row.length) {
    const next = row.find((i) => drag.x < rects[i].left + rects[i].width / 2);
    index = next !== undefined ? next : row[row.length - 1] + 1;
  }

  // Âncora real: primeiro atalho à frente que não esteja sendo arrastado.
  const dragged = new Set(drag.ids);
  const before = children.slice(index).find((child) => !dragged.has(child.dataset.siteId));

  section.classList.add('drop-alvo');
  drag.highlight = section;
  if (children.length) {
    // No fim de uma linha, a linha do indicador fica após o último atalho dela.
    const after = index > 0 && (index === children.length || Math.abs(rects[index].top - rects[index - 1].top) > 5);
    const ref = after ? rects[index - 1] : rects[index];
    showIndicator({ left: (after ? ref.right + 6 : ref.left - 6) - 1.5, top: ref.top, width: 3, height: ref.height });
  }
  return {
    overZone: false,
    topicId: section.classList.contains('orfaos') ? null : section.id,
    beforeSiteId: before?.dataset.siteId ?? null,
  };
}

// Destino de partições: antes/depois da seção sob o cursor (metade superior/inferior).
function findTopicDrop(under) {
  const target = under?.closest('#app section.divisao:not(.orfaos)');
  if (!target) return null;
  const sections = [...$('#app').querySelectorAll('section.divisao:not(.orfaos)')];
  const rect = target.getBoundingClientRect();
  const index = sections.indexOf(target) + (drag.y > rect.top + rect.height / 2 ? 1 : 0);

  const dragged = new Set(drag.ids);
  const before = sections.slice(index).find((section) => !dragged.has(section.id));

  const atEnd = index >= sections.length;
  const ref = sections[atEnd ? sections.length - 1 : index].getBoundingClientRect();
  showIndicator({ left: ref.left, top: (atEnd ? ref.bottom : ref.top) - 1.5, width: ref.width, height: 3 });
  return { overZone: false, beforeTopicId: before?.id ?? null };
}

function updateAutoScroll() {
  const topEdge = $('header').getBoundingClientRect().bottom + AUTOSCROLL_EDGE_PX;
  drag.scrollStep = 0;
  if (!drag.drop?.overZone && drag.y < topEdge) drag.scrollStep = -AUTOSCROLL_STEP_PX;
  else if (drag.y > window.innerHeight - AUTOSCROLL_EDGE_PX) drag.scrollStep = AUTOSCROLL_STEP_PX;
  if (drag.scrollStep && scrollFrame === null) scrollFrame = requestAnimationFrame(autoScrollTick);
}

function autoScrollTick() {
  scrollFrame = null;
  if (!drag?.active || !drag.scrollStep) return;
  window.scrollBy(0, drag.scrollStep);
  scrollFrame = requestAnimationFrame(autoScrollTick);
}

// A rolagem (roda ou automática) move os elementos sob o cursor: recalcula o destino.
function onDragScroll() {
  if (drag?.active) updateDropTarget();
}

function onDragEnd(event) {
  const finished = drag;
  const drop = finished?.drop;
  finishDrag();
  if (!finished) return;

  if (!finished.active) {
    if (!isMulti(event)) clearSelection(); // clique simples limpa a seleção
    return;
  }
  swallowNextClick();
  if (!drop) return;
  if (finished.kind === 'site') {
    dragHandlers.onDropSites({ siteIds: finished.ids, topicId: drop.topicId, beforeSiteId: drop.beforeSiteId });
  } else {
    dragHandlers.onDropTopics({ topicIds: finished.ids, beforeTopicId: drop.beforeTopicId });
  }
}

function cancelDrag() {
  finishDrag();
  swallowNextClick();
}

// Remove listeners, elementos auxiliares e marcações. Não mexe na seleção.
function finishDrag() {
  if (!drag) return;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', finishDrag);
  window.removeEventListener('scroll', onDragScroll);
  if (drag.active) {
    clearDropVisuals();
    drag.ghost.remove();
    drag.indicator.remove();
    drag.zone?.remove();
    document.body.classList.remove('arrastando-ativo');
    for (const id of drag.ids) draggedElement(drag.kind, id)?.classList.remove('arrastando');
  }
  cancelAnimationFrame(scrollFrame);
  scrollFrame = null;
  drag = null;
}

// O navegador dispara um click após soltar o botão; ele não deve abrir o link nem alternar seleção.
function swallowNextClick() {
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
}

// Ctrl+clique alterna a seleção (e nunca abre o link); clique logo após arraste é ignorado.
function onSelectionClick(event) {
  if (suppressClick) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (!isMulti(event)) return;
  const item = dragItemAt(event.target);
  if (!item) return;
  event.preventDefault();
  event.stopPropagation();
  toggleSelection(item.kind, item.id);
}

// ---------- Toast ----------

function dismissToast(toast) {
  if (toast.classList.contains('saindo')) return;
  toast.classList.add('saindo');
  removeLater(toast, 320);
}

export function showToast(message, type = 'info') {
  // Um toast por vez: o anterior sai suavemente.
  document.querySelectorAll('.toast').forEach(dismissToast);
  const toast = el('div', `toast toast-${type}`);
  toast.setAttribute('role', 'status');
  toast.append(icon(type === 'error' ? 'error' : 'info'), el('span', '', message));
  document.body.append(toast);
  setTimeout(() => dismissToast(toast), 3500);
}
