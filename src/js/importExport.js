// Parse/stringify do backup JSON e manipulação de arquivos (Blob/FileReader).
// Não conhece o estado da aplicação: a mesclagem fica em storage.js.

const BACKUP_FILENAME = 'utilit-backup.json';
// Compartilhado como .txt: Chrome/Edge não compartilham .json (lista do Chromium).
// O conteúdo é o mesmo JSON; a importação aceita as duas extensões.
const SHARE_FILENAME = 'utilit-backup.txt';
const IMPORT_EXTENSIONS = ['.json', '.txt'];

export function parseBackup(text) {
  let parsed;
  try {
    // Remove o BOM que alguns editores colocam no início do texto.
    parsed = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  if (!isObject || !('version' in parsed) || !('topics' in parsed) || !Array.isArray(parsed.topics)) {
    throw new Error('Estrutura inválida: o backup precisa das propriedades "version" e "topics".');
  }
  return parsed;
}

export function readBackupFile(file) {
  const name = String(file?.name ?? '').toLowerCase();
  if (!IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return Promise.reject(new Error('Formato não suportado: selecione um backup .json ou .txt.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseBackup(String(reader.result)));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsText(file);
  });
}

const backupJson = (data) => JSON.stringify(data, null, 2);

export function exportBackup(data) {
  const blob = new Blob([backupJson(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = BACKUP_FILENAME;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Compartilhamento (Web Share API) ----------

const SHARE_TITLE = 'Backup UtiliT';
const SHARE_TEXT = 'Backup dos meus atalhos do UtiliT.';

// Abre o menu nativo de compartilhamento com o JSON anexado.
// Precisa ser chamada dentro de um gesto do usuário (clique).
// Devolve 'shared' | 'cancelled' | 'unsupported' | 'failed'.
export async function shareBackup(data) {
  let file;
  try {
    file = new File([backupJson(data)], SHARE_FILENAME, { type: 'text/plain' });
  } catch {
    return 'unsupported';
  }
  try {
    if (!navigator.canShare?.({ files: [file] })) return 'unsupported';
  } catch {
    return 'unsupported';
  }
  try {
    await navigator.share({ files: [file], title: SHARE_TITLE, text: SHARE_TEXT });
    return 'shared';
  } catch (err) {
    return err?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

// Links de reserva: só texto preenchido, pois nenhum dos dois aceita anexo por URL.
export function shareFallbackLinks() {
  const body = `${SHARE_TEXT} O arquivo ${BACKUP_FILENAME} segue em anexo.`;
  const params = new URLSearchParams({ view: 'cm', fs: '1', su: SHARE_TITLE, body });
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(body)}`,
    gmail: `https://mail.google.com/mail/?${params}`,
  };
}
