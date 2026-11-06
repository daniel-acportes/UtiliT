// Manipulação do DOM: renderização, menus flutuantes, modais e toasts.
// Não contém regras de negócio: recebe dados prontos e devolve ações via callbacks.
// Todo texto vindo do usuário ou de backups é inserido com textContent (nunca innerHTML).

import { faviconUrl } from './storage.js';

const FALLBACK_ICON = './assets/icone-site.png';
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
const EDGE_MARGIN_PX = 8;

let activeModal = null; // { overlay, close }
let activeMenu = null;  // { node, anchor }

const $ = (selector, root = document) => root.querySelector(selector);
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

// ---------- Renderização da página ----------

export function renderApp(data, handlers) {
  closeFloatingMenu();
  resetDragAndSelection();
  renderNav(data.topics);

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
  updateNavScrollbar();
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
}

function createTopicSection(topic, handlers, minimized) {
  const section = el('section', minimized ? 'divisao minimizado' : 'divisao');
  section.id = topic.id;

  const container = el('div', 'topico container');
  const header = el('div', 'nome-topico');
  header.append(el('h1', '', topic.title));
  attachLongPress(header, () =>
    openFloatingMenu({
      anchor: header,
      gear: true,
      items: [
        { label: 'Editar partição', onClick: () => handlers.onEditTopic(topic.id) },
        { label: 'Mover atalhos', onClick: () => handlers.onMoveTopicSites(topic.id) },
        { label: 'Excluir partição', danger: true, onClick: () => handlers.onDeleteTopic(topic.id) },
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

  const icon = el('img');
  icon.alt = site.name;
  icon.draggable = false;
  icon.src = faviconUrl(site.url);
  icon.addEventListener('error', () => { icon.src = FALLBACK_ICON; }, { once: true });

  link.append(icon);
  button.append(link);
  wrapper.append(button, el('h2', 'site-name', site.name));

  attachLongPress(wrapper, () =>
    openFloatingMenu({
      anchor: wrapper,
      gear: true,
      items: [
        { label: 'Editar atalho', onClick: () => handlers.onEditSite(site.id) },
        { label: 'Excluir atalho', danger: true, onClick: () => handlers.onDeleteSite(site.id) },
      ],
    }),
  );
  return wrapper;
}

// ---------- Long-press ----------

// Segura 500ms; mover mais que a tolerância cancela. Após disparar, o clique
// seguinte (que abriria o link) é suprimido.
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

  node.addEventListener('contextmenu', (event) => {
    if (timer || fired) event.preventDefault();
  });
}

// ---------- Menu flutuante (popup) ----------

// items: [{ label, onClick, danger? }]. gear = true mostra só a engrenagem;
// as ações aparecem ao tocar nela.
export function openFloatingMenu({ anchor, items, gear = false }) {
  closeFloatingMenu();

  const node = el('div', 'floating-menu');
  setStyles(node, { position: 'fixed', zIndex: '1500', visibility: 'hidden' });

  const list = el('div', 'floating-menu-items');
  for (const item of items) {
    const button = el('button', item.danger ? 'floating-menu-item danger' : 'floating-menu-item', item.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      closeFloatingMenu();
      item.onClick();
    });
    list.append(button);
  }

  if (gear) {
    const toggle = el('button', 'floating-menu-gear');
    toggle.append(icon('settings'));
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Ações');
    list.hidden = true;
    toggle.addEventListener('click', () => {
      list.hidden = !list.hidden;
      positionMenu(node, anchor);
    });
    node.append(toggle, list);
  } else {
    node.append(list);
  }

  document.body.append(node);
  activeMenu = { node, anchor };
  positionMenu(node, anchor);
  node.style.visibility = 'visible';
}

export function closeFloatingMenu() {
  if (!activeMenu) return;
  activeMenu.node.remove();
  activeMenu = null;
}

function positionMenu(node, anchor) {
  const rect = anchor.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = node;
  let top = rect.top - height - EDGE_MARGIN_PX;
  if (top < EDGE_MARGIN_PX) top = rect.bottom + EDGE_MARGIN_PX;
  const left = clamp(
    rect.left + rect.width / 2 - width / 2,
    EDGE_MARGIN_PX,
    window.innerWidth - width - EDGE_MARGIN_PX,
  );
  setStyles(node, { top: `${top}px`, left: `${left}px` });
}

// ---------- Botão flutuante '+' ----------

// Clicar no '+' alterna o menu de ações (nova partição, novo atalho, importar, exportar).
export function mountFab(items) {
  const fab = el('button', 'fab');
  fab.append(icon('add'));
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Adicionar');
  setStyles(fab, {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    zIndex: '1200',
    fontSize: '32px',
    lineHeight: '1',
    cursor: 'pointer',
  });
  fab.addEventListener('click', () => {
    if (activeMenu?.anchor === fab) {
      closeFloatingMenu();
      return;
    }
    openFloatingMenu({ anchor: fab, items });
  });
  document.body.append(fab);
}

// ---------- Modais ----------

export function openModal({ title, content }) {
  closeModal();

  const overlay = el('div', 'modal-overlay');
  setStyles(overlay, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '2000',
  });

  const dialog = el('div', 'modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const error = el('p', 'modal-error');
  error.hidden = true;
  dialog.append(el('h2', 'modal-title', title), content, error);
  overlay.append(dialog);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeModal();
  });

  document.body.append(overlay);
  activeModal = { overlay, close: closeModal };
  content.querySelector('input, select')?.focus();

  return {
    close: closeModal,
    showError(message) {
      error.textContent = message;
      error.hidden = !message;
    },
  };
}

function closeModal() {
  if (!activeModal) return;
  activeModal.overlay.remove();
  activeModal = null;
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
    if (activeMenu.node.contains(event.target) || activeMenu.anchor.contains(event.target)) return;
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

  const modal = openModal({ title: topic ? 'Editar partição' : 'Nova partição', content: form });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitWith(modal, () => onSubmit(titleInput.value));
  });
}

// onSubmit({ name, url, topicId }) — topicId null = sem partição. Nome opcional.
export function openSiteModal({ site = null, topicId = null, topics, onSubmit }) {
  const form = el('form', 'modal-form');
  const nameInput = textInput(site?.name ?? '', 'Vazio = domínio do site');
  const urlInput = textInput(site?.url ?? '', 'exemplo.com ou https://exemplo.com');
  urlInput.required = true;
  urlInput.inputMode = 'url';

  const select = el('select', 'field-input');
  select.append(new Option('Nenhuma', ''));
  for (const t of topics) select.append(new Option(t.title, t.id));
  select.value = topicId ?? '';

  const cancel = actionButton('Cancelar');
  const save = el('button', 'btn btn-primary', site ? 'Salvar' : 'Adicionar');
  save.type = 'submit';
  form.append(
    labeled('Nome', nameInput),
    labeled('Endereço', urlInput),
    labeled('Partição', select),
    actionRow(cancel, save),
  );

  const modal = openModal({ title: site ? 'Editar atalho' : 'Novo atalho', content: form });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitWith(modal, () =>
      onSubmit({ name: nameInput.value, url: urlInput.value, topicId: select.value || null }),
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

  const modal = openModal({ title, content: form });
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
  fileInput.accept = '.json,application/json';

  const cancel = actionButton('Cancelar');
  const save = el('button', 'btn btn-primary', 'Importar');
  save.type = 'submit';
  form.append(labeled('Arquivo de backup (.json)', fileInput), actionRow(cancel, save));

  const modal = openModal({ title: 'Importar backup', content: form });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitWith(modal, () => {
      const file = fileInput.files?.[0];
      if (!file) return 'Selecione um arquivo .json.';
      return onFile(file);
    });
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

  const modal = openModal({ title: 'Mover atalhos', content: form });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitWith(modal, () => onSubmit(select.value || null));
  });
}

// ---------- Barra de rolagem da lista de partições ----------

const NAV_THUMB_MIN_PX = 40;
let navBar = null;
let navThumb = null;
let navOver = false;   // cursor sobre a lista
let barOver = false;   // cursor sobre a barra
let navDrag = null;    // { startX, startScroll } durante o arraste do polegar

function navMetrics() {
  const nav = $('.nav-links');
  const trackW = nav.clientWidth;
  const max = nav.scrollWidth - nav.clientWidth;
  const thumbW = Math.max(NAV_THUMB_MIN_PX, trackW * (nav.clientWidth / nav.scrollWidth));
  return { trackW, thumbW, max, scrollable: max > 0 };
}

function setNavBarVisible() {
  navBar.classList.toggle('visible', navOver || barOver || navDrag !== null);
}

// Posiciona a barra sob a lista e move o polegar conforme o scroll.
function updateNavScrollbar() {
  if (!navBar) return;
  const nav = $('.nav-links');
  const { trackW, thumbW, max, scrollable } = navMetrics();
  const headerLeft = $('header').getBoundingClientRect().left;
  const rect = nav.getBoundingClientRect();
  setStyles(navBar, {
    display: scrollable ? '' : 'none',
    left: `${rect.left - headerLeft}px`,
    width: `${trackW}px`,
  });
  if (!scrollable) return;
  const offset = (nav.scrollLeft / max) * (trackW - thumbW);
  setStyles(navThumb, { width: `${thumbW}px`, transform: `translateX(${offset}px)` });
}

export function mountNavScrollbar() {
  const nav = $('.nav-links');
  navBar = el('div', 'nav-scrollbar');
  navThumb = el('div', 'nav-scrollbar-thumb');
  navBar.append(navThumb);
  $('header').append(navBar);

  nav.addEventListener('pointerenter', () => { navOver = true; setNavBarVisible(); });
  nav.addEventListener('pointerleave', () => { navOver = false; setNavBarVisible(); });
  navBar.addEventListener('pointerenter', () => { barOver = true; setNavBarVisible(); });
  navBar.addEventListener('pointerleave', () => { barOver = false; setNavBarVisible(); });
  nav.addEventListener('scroll', updateNavScrollbar, { passive: true });
  window.addEventListener('resize', updateNavScrollbar);

  navThumb.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    navDrag = { startX: event.clientX, startScroll: nav.scrollLeft };
    navThumb.setPointerCapture(event.pointerId);
    setNavBarVisible();
  });
  navThumb.addEventListener('pointermove', (event) => {
    if (!navDrag) return;
    const { trackW, thumbW, max } = navMetrics();
    const span = trackW - thumbW;
    if (span <= 0) return;
    nav.scrollLeft = navDrag.startScroll + (event.clientX - navDrag.startX) * (max / span);
  });
  const endDrag = () => {
    navDrag = null;
    setNavBarVisible();
  };
  navThumb.addEventListener('pointerup', endDrag);
  navThumb.addEventListener('pointercancel', endDrag);

  updateNavScrollbar();
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

export function showToast(message, type = 'info') {
  const toast = el('div', `toast toast-${type}`, message);
  toast.setAttribute('role', 'status');
  setStyles(toast, {
    position: 'fixed',
    left: '50%',
    bottom: '100px',
    transform: 'translateX(-50%)',
    zIndex: '3000',
    maxWidth: '90vw',
  });
  document.body.append(toast);
  setTimeout(() => toast.remove(), 3500);
}
