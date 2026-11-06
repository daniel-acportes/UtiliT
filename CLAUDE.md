# Regras de Desenvolvimento e Harness do Agente — UtiliT

## 1. Visão Geral e Arquitetura

* **Plataforma:** GitHub Pages (hospedagem 100% estática client-side).
* **Stack Tecnológica:** HTML5, CSS3 e JavaScript Vanilla ES6+ (usando ES Modules nativos via `<script type="module">`). É proibido o uso de frameworks (React, Vue, etc.), pré-processadores ou bundlers.
* **Estrutura de Arquivos e Módulos:**
  * `index.html` (Estrutura base da aplicação)
  * `style.css` (Estilos visuais com variáveis `:root`)
  * `src/js/storage.js` (Gerenciamento de dados e `localStorage`)
  * `src/js/ui.js` (Manipulação do DOM, modais e renderização)
  * `src/js/importExport.js` (Validação e download/upload do backup JSON)
  * `src/js/main.js` (Ponto de entrada e escutadores de eventos principais)

## 2. Preservação do Design System Atualizado

* **Integridade Visual:** Respeite rigorosamente as variáveis de CSS definidas em `:root` (`--background-dark-color`, `--primary-dark-opacity-color`, `--primary-color`, etc.) e as fontes (`Rajdhani`, `Oswald`).
* **Regra de Transição (Fade-In do Nome do Site):** O texto em `.site-name` inicia oculto (`opacity: 0`). Certifique-se de que a interação no hover revela o elemento via CSS:
  
  ```css
  .site:hover .site-name { opacity: 1; }
  ```
  
* **Hierarquia DOM Obrigatória na Renderização:** Todo elemento gerado dinamicamente via JS em `ui.js` deve seguir estritamente o novo padrão markup:
  
  ```html
  <section class="divisao" id="ID_TOPICO">
    <div class="topico container">
      <div class="nome-topico">
        <h1>TITULO_DA_PARTICAO</h1>
      </div>
      <div class="sites-grid">
        <div class="site">
          <div class="button">
            <a href="URL_SITE" target="_blank">
              <img src="FAVICON_URL" alt="NOME_SITE">
            </a>
          </div>
          <h2 class="site-name">NOME_SITE</h2>
        </div>
      </div>
    </div>
  </section>
  ```

* **Menu de Navegação:** A barra superior `.nav-links` deve renderizar dinamicamente itens `<li><a class="nav-link" href="#ID_TOPICO">TITULO</a></li>`.

## 3. Armazenamento e Gerenciamento de Dados (`localStorage`)

* **Chave Principal:** Armazene todos os dados no `localStorage` sob a chave `utilit_data`.
* **Carga Inicial:** A primeira visita de um novo usuário deve carregar a página totalmente limpa (estado zero), sem partições ou dados padrão.
* **Estrutura do Data Schema (JSON):**

  ```json
  {
    "version": "1.0",
    "topics": [
      {
        "id": "divisao1",
        "title": "Divisão 1",
        "sites": [
          {
            "id": "site_1",
            "name": "Google",
            "url": "https://www.google.com"
          }
        ]
      }
    ]
  }
  ```

* **Favicons Automáticos e Formatação:**
  * Formatação automática de URLs cadastradas sem protocolo para 'https://'.
  * Carregue os favicons via API pública do Google: `https://www.google.com/s2/favicons?domain={DOMAIN}&sz=128`
  * Adicione Fallback para favicons com falha utilizando `./assets/icone-site.png`.

## 4. Portabilidade (Importação e Exportação JSON)

* **Exportação (`importExport.js`):** Gerar o download automático do arquivo `utilit-backup.json` com o estado atualizado dos dados.
* **Importação (`importExport.js`):** Processar arquivos `.json` selecionados pelo usuário.
  * **Validação:** Verifique a presença das propriedades `version` e `topics` antes de gravar. Notifique erro caso a estrutura seja inválida.
  * **Regras de Merge (Mesclagem):**
    * Sites na mesma partição com mesmo endereço: o novo site do JSON substitui o existente.
    * Importação, partição de mesmo nome: substitui título/ID pelos do backup e mescla sites; sites antigos ausentes no backup são preservados; mesma URL → versão do backup vence.]
    * Importação, órfãos: somados aos existentes, com dedupe por URL.

## 5. Funcionalidades Dinâmicas (CRUD & DOM)

* **Elementos de UI Exigidos:**
  * *Botão '+':* mini-menu com Nova partição / Novo atalho / Importar backup / Exportar backup.
  * *Long-press:* 500 ms, pointer events, cancela ao mover mais de 10 px; suprime a navegação do link; popup com engrenagem → Editar/Excluir.
* **Gerenciamento de Partições:**
  * Inclusão, edição de título e exclusão.
  * *Partições vazias (sem atalhos):* Devem ser exibidas apenas no final da página, renderizadas minimizadas e translúcidas.
  * *Exclusão de Partição:* Exibir modal de confirmação com a checkbox "Exclua também os seus atalhos" (marcada por padrão). Se desmarcada, os atalhos são preservados como órfãos.
  * *Criar/renomear partição com nome já existente:* mescla automaticamente (sem duplicar; abre a existente).
  * *IDs de partição:* slug do título, com sufixo numérico se já existir (ex.: divisao-1, divisao-1-2). Sites: site_<timestamp>.

* **Gerenciamento de Atalhos:** Suporte para criação e remoção de links dentro de uma partição específica.
  * *Atalhos sem partição (órfãos):* ficam num grid único no topo da página, sem cabeçalho nem partição placeholder.
  * *Atalho:* URL validada com new URL() após prefixar https://; URL inválida ou duplicada na mesma partição é bloqueada.
  * *Modal de atalho:* select de partição com opção "Nenhuma"; nome opcional (vazio usa o domínio).
  * *Mover atalhos* (menu de configurações da partição)
    * Long-press na partição → "Mover atalhos": modal com select de destino (outras partições + "Sem partição (órfãos)").
    * Duplicata (mesma URL) no destino: o atalho movido substitui o existente.

* **Arrastar e soltar elementos (mouse, botão esquerdo) + seleção múltipla**
  * *Para iniciar arraste:* Mover o cursor >10px com o botão pressionado inicia o arraste; parado 500ms continua abrindo a engrenagem.
  * *Atalhos:* soltar sobre partição move; soltar entre atalhos insere na posição; faixa "Solte aqui para deixar sem partição" aparece sob o cabeçalho durante o arraste; soltar na seção de órfãos também vale. Duplicata no destino: o movido substitui.
  * *Partições:* arrastar pelo título reordena; vazias sempre no fim.
  * Ctrl+clique alterna seleção (destaque visual); arrastar item selecionado leva todos, não selecionado leva só ele. Atalhos e partições não se misturam na seleção. Ctrl+clique não abre o link.
  * Clicar fora ou Esc limpa a seleção; Esc durante o arraste cancela. Auto-scroll perto das bordas da tela durante o arraste.
* **Modais Dark Theme:** Os formulários para adição/edição de links, partições e upload de backups devem ser modais sobrepostos (fundo `var(--primary-dark-opacity-color)` com `backdrop-filter`, bordas claras).


## 6. Boas Práticas e Organização do Código

* **Modularidade Efetiva:**
  * `storage.js`: Apenas funções puras de manipulação e persistência de dados.
  * `ui.js`: Apenas funções de criação/atualização de elementos no DOM e modais.
  * `importExport.js`: Lógica de Parse/Stringify de JSON e manipulação de arquivos Blob.
  * `main.js`: Ponto de ligação e registro dos escutadores de eventos.
* **Tratamento de Exceções:** Trate erros em chamadas `JSON.parse()` e operações de leitura de arquivos com blocos `try/catch`.

## 7. Workflow de Desenvolvimento e Triagem

* Ao ser acionado para criar novas features ou alterar lógicas que exijam decisões de negócio, o agente DEVE consultar estritamente o protocolo da skill salva no arquivo `grill-me-triage.md`.
