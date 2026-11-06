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
} from './storage.js';
import { exportBackup, readBackupFile } from './importExport.js';
import {
  renderApp,
  mountFab,
  openTopicModal,
  openSiteModal,
  openConfirmModal,
  openImportModal,
  openMoveModal,
  showToast,
  mountNavScrollbar,
  mountDragAndDrop,
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

// ---------- Atalhos ----------

function addSite() {
  openSiteModal({
    topics: data.topics,
    onSubmit: (input) => {
      const result = saveSite(data, input);
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
    onSubmit: (input) => {
      const result = saveSite(data, { ...input, siteId });
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

render();
mountNavScrollbar();
mountDragAndDrop({
  onDeleteSelection: askDeleteSelection,
  onDropSites: ({ siteIds, topicId, beforeSiteId }) => applyDrop(moveSitesTo(data, siteIds, topicId, beforeSiteId)),
  onDropTopics: ({ topicIds, beforeTopicId }) => applyDrop(reorderTopics(data, topicIds, beforeTopicId)),
});
mountFab([
  { label: 'Nova partição', onClick: addTopic },
  { label: 'Novo atalho', onClick: addSite },
  { label: 'Importar backup', onClick: importBackup },
  { label: 'Exportar backup', onClick: exportData },
]);
