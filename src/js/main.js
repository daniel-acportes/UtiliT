// Ponto de entrada: liga dados (storage), DOM (ui) e portabilidade (importExport).
// Cada ação passa por storage, persiste com commit() e re-renderiza a página.

import {
  loadData,
  saveData,
  createTopic,
  renameTopic,
  deleteTopic,
  saveSite,
  deleteSite,
  deleteSites as deleteSitesBulk,
  deleteTopics,
  findSite,
  mergeImported,
  moveTopicSites,
  moveSitesTo,
  reorderTopics,
  setAppearance,
  accentTokens,
  accentModeFor,
  ACCENT_PALETTE,
  normalizeUrl,
  matchBrand,
  resolveMissingBrands,
  hasMissingBrands,
  hasContent,
} from './storage.js';
import { exportBackup, readBackupFile, shareBackup, shareFallbackLinks } from './importExport.js';
import {
  renderApp,
  mountFab,
  openTopicModal,
  openSiteModal,
  openConfirmModal,
  openImportModal,
  openShareFallbackModal,
  openMoveModal,
  openThemeModal,
  showToast,
  mountNav,
  mountDragAndDrop,
  applyTheme,
  loadBrandIndex,
} from './ui.js';

const SAVE_ERROR = 'Não foi possível salvar. Verifique o armazenamento do navegador.';

let data = loadData();

// Salva e re-renderiza. Devolve null em sucesso ou a mensagem de erro.
function commit(next) {
  if (!saveData(next)) return SAVE_ERROR;
  data = next;
  render();
  return null;
}

function render() {
  renderApp(data, handlers);
}

const handlers = {
  onEditTopic: (topicId) => editTopic(topicId),
  onDeleteTopic: (topicId) => askDeleteTopic(topicId),
  onEditSite: (siteId) => editSite(siteId),
  onDeleteSite: (siteId) => askDeleteSite(siteId),
  onMoveTopicSites: (topicId) => moveSites(topicId),
};

// ---------- Partições ----------

function addTopic() {
  openTopicModal({
    onSubmit: (title) => {
      const result = createTopic(data, title);
      if (result.error) return result.error;
      const saveError = commit(result.data);
      if (saveError) return saveError;
      if (result.merged) showToast('Já existia uma partição com esse nome; ela foi aberta.');
      location.hash = result.topicId;
      return null;
    },
  });
}

function editTopic(topicId) {
  const topic = data.topics.find((t) => t.id === topicId);
  if (!topic) return;
  openTopicModal({
    topic,
    onSubmit: (title) => {
      const result = renameTopic(data, topicId, title);
      if (result.error) return result.error;
      const saveError = commit(result.data);
      if (saveError) return saveError;
      if (result.merged) showToast('Já existia uma partição com esse nome; os atalhos foram mesclados nela.');
      return null;
    },
  });
}

function askDeleteTopic(topicId) {
  const topic = data.topics.find((t) => t.id === topicId);
  if (!topic) return;
  openConfirmModal({
    title: 'Excluir partição',
    message: `Excluir a partição "${topic.title}"?`,
    confirmLabel: 'Excluir',
    danger: true,
    checkbox: { label: 'Exclua também os seus atalhos', checked: true },
    onConfirm: (deleteSites) => {
      const result = deleteTopic(data, topicId, deleteSites);
      if (result.error) return showToast(result.error, 'error');
      const saveError = commit(result.data);
      if (saveError) showToast(saveError, 'error');
    },
  });
}

function moveSites(topicId) {
  const topic = data.topics.find((t) => t.id === topicId);
  if (!topic) return;
  openMoveModal({
    topic,
    targets: data.topics.filter((t) => t.id !== topicId),
    onSubmit: (targetId) => {
      const result = moveTopicSites(data, topicId, targetId);
      if (result.error) return result.error;
      const saveError = commit(result.data);
      if (saveError) return saveError;
      const target = targetId ? data.topics.find((t) => t.id === targetId) : null;
      showToast(`Atalhos movidos para ${target ? `"${target.title}"` : 'os órfãos'}.`);
      return null;
    },
  });
}

// ---------- Ícones de marca (thesvg.org) ----------

// Marca do endereço pelo manifesto do thesvg: slug, null (sem marca) ou undefined
// (manifesto indisponível — fica para a migração em segundo plano).
async function autoBrand(url) {
  const clean = normalizeUrl(url);
  if (!clean) return undefined;
  try {
    return matchBrand(await loadBrandIndex(), clean);
  } catch {
    return undefined;
  }
}

// Atalhos sem marca resolvida (antigos ou importados) são resolvidos uma vez, em segundo plano.
let migratingBrands = false;
async function migrateBrands() {
  if (migratingBrands || !hasMissingBrands(data)) return;
  migratingBrands = true;
  try {
    const index = await loadBrandIndex();
    const result = resolveMissingBrands(data, index); // usa o estado atual, após o download
    if (result.changed) {
      const saveError = commit(result.data);
      if (saveError) console.warn(saveError);
    }
  } catch (err) {
    console.warn('UtiliT: thesvg.org indisponível; as marcas serão buscadas na próxima visita.', err);
  } finally {
    migratingBrands = false;
  }
}

// Completa a escolha do modal: sem marca manual, resolve a automática antes de salvar.
async function withBrand(input) {
  return input.brand === undefined ? { ...input, brand: await autoBrand(input.url) } : input;
}

// ---------- Atalhos ----------

function addSite() {
  openSiteModal({
    topics: data.topics,
    onSubmit: async (input) => {
      const result = saveSite(data, await withBrand(input));
      if (result.error) return result.error;
      return commit(result.data);
    },
  });
}

function editSite(siteId) {
  const found = findSite(data, siteId);
  if (!found) return;
  openSiteModal({
    site: found.site,
    topicId: found.topicId,
    topics: data.topics,
    onSubmit: async (input) => {
      const result = saveSite(data, { ...(await withBrand(input)), siteId });
      if (result.error) return result.error;
      return commit(result.data);
    },
  });
}

function askDeleteSite(siteId) {
  const found = findSite(data, siteId);
  if (!found) return;
  openConfirmModal({
    title: 'Excluir atalho',
    message: `Remover o atalho "${found.site.name}"?`,
    confirmLabel: 'Excluir',
    danger: true,
    onConfirm: () => {
      const result = deleteSite(data, siteId);
      if (result.error) return showToast(result.error, 'error');
      const saveError = commit(result.data);
      if (saveError) showToast(saveError, 'error');
    },
  });
}

// ---------- Backup ----------

function importBackup() {
  openImportModal({
    onFile: async (file) => {
      let backup;
      try {
        backup = await readBackupFile(file);
      } catch (err) {
        return err instanceof Error ? err.message : 'Arquivo inválido.';
      }
      const saveError = commit(mergeImported(data, backup));
      if (saveError) return saveError;
      showToast('Backup importado com sucesso.');
      migrateBrands();
      return null;
    },
  });
}

function exportData() {
  try {
    exportBackup(data);
  } catch (err) {
    console.error(err);
    showToast('Não foi possível exportar o backup.', 'error');
  }
}

// Baixa o backup e abre o menu nativo de compartilhamento com o JSON anexado.
// Chamada direto do clique (o share exige gesto do usuário). Cancelar é silencioso;
// sem suporte ou com erro, abre o modal com WhatsApp Web / Gmail.
async function shareData() {
  if (!hasContent(data)) return showToast('Nada para compartilhar ainda.');
  exportData();
  const status = await shareBackup(data);
  if (status === 'unsupported' || status === 'failed') {
    openShareFallbackModal({ links: shareFallbackLinks(), failed: status === 'failed' });
  }
}

// ---------- Tema ----------

// Sem escolha salva (settings.theme), o tema segue o sistema operacional.
const systemLight = window.matchMedia('(prefers-color-scheme: light)');
const resolveTheme = (mode) => (mode === 'dark' || mode === 'light' ? mode : systemLight.matches ? 'light' : 'dark');

// Aparência em pré-visualização no modal de Temas ({ theme, accent }); null = a salva.
let themePreview = null;

// Aplica modo + cor de destaque. A cor é ajustada ao modo se ficar ilegível nele.
function applyAppearance({ theme, accent } = {}, animate = false) {
  const mode = resolveTheme(theme);
  applyTheme(mode, animate, accent ? accentTokens(accent, mode) : null);
}

const AUTO_SWITCH_MESSAGE = {
  light: 'Cor muito escura para o modo escuro — mudamos para o modo claro.',
  dark: 'Cor muito clara para o modo claro — mudamos para o modo escuro.',
};

function openThemes() {
  openThemeModal({
    palette: ACCENT_PALETTE,
    initial: { mode: data.settings?.theme ?? 'system', accent: data.settings?.accent ?? null },
    onPreview: (draft, { check, animate }) => {
      let { mode } = draft;
      if (check && draft.accent) {
        const shown = resolveTheme(mode);
        const best = accentModeFor(draft.accent, shown);
        if (best !== shown) {
          mode = best;
          showToast(AUTO_SWITCH_MESSAGE[best]);
        }
      }
      themePreview = { theme: mode === 'system' ? undefined : mode, accent: draft.accent };
      applyAppearance(themePreview, animate);
      return mode;
    },
    onSubmit: (draft) => {
      const result = setAppearance(data, { theme: draft.mode === 'system' ? null : draft.mode, accent: draft.accent });
      if (result.error) return result.error;
      // Só preferência: salva sem re-renderizar a página.
      if (!saveData(result.data)) return SAVE_ERROR;
      data = result.data;
      themePreview = null;
      applyAppearance(data.settings);
      return null;
    },
    onCancel: () => {
      themePreview = null;
      applyAppearance(data.settings, true);
    },
  });
}

systemLight.addEventListener('change', () => {
  const shown = themePreview ?? data.settings ?? {};
  if (!shown.theme) applyAppearance(shown, true);
});

// ---------- Inicialização ----------

// Aplica o resultado de uma operação de arraste: erro vira toast; sucesso é salvo e renderizado.
function applyDrop(result) {
  if (result.error) {
    showToast(result.error, 'error');
    return;
  }
  const saveError = commit(result.data);
  if (saveError) showToast(saveError, 'error');
}

// Exclusão da seleção múltipla (lixeira flutuante), sempre com confirmação.
function askDeleteSelection({ kind, ids }) {
  const count = ids.length;
  if (kind === 'site') {
    openConfirmModal({
      title: 'Excluir atalhos',
      message: count === 1 ? 'Remover o atalho selecionado?' : `Remover os ${count} atalhos selecionados?`,
      confirmLabel: 'Excluir',
      danger: true,
      onConfirm: () => applyDrop(deleteSitesBulk(data, ids)),
    });
    return;
  }
  openConfirmModal({
    title: 'Excluir partições',
    message: count === 1 ? 'Excluir a partição selecionada?' : `Excluir as ${count} partições selecionadas?`,
    confirmLabel: 'Excluir',
    danger: true,
    checkbox: { label: 'Exclua também os seus atalhos', checked: true },
    onConfirm: (withSites) => applyDrop(deleteTopics(data, ids, withSites)),
  });
}

applyAppearance(data.settings);
render();
mountNav();
mountDragAndDrop({
  onDeleteSelection: askDeleteSelection,
  onDropSites: ({ siteIds, topicId, beforeSiteId }) => applyDrop(moveSitesTo(data, siteIds, topicId, beforeSiteId)),
  onDropTopics: ({ topicIds, beforeTopicId }) => applyDrop(reorderTopics(data, topicIds, beforeTopicId)),
});
mountFab([
  { label: 'Nova partição', icon: 'create_new_folder', onClick: addTopic },
  { label: 'Novo atalho', icon: 'add_link', onClick: addSite },
  { separator: true },
  { label: 'Importar backup', icon: 'upload_file', onClick: importBackup },
  { label: 'Exportar backup', icon: 'download', onClick: exportData },
  { label: 'Compartilhar backup', icon: 'share', onClick: shareData },
  { separator: true },
  { label: 'Temas', icon: 'palette', onClick: openThemes },
]);
migrateBrands();
