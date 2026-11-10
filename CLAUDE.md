# Regras de Desenvolvimento e Harness do Agente — UtiliT

## 1. Visão Geral e Arquitetura

* **Plataforma:** GitHub Pages (100% estático, client-side).
* **Stack:** HTML5, CSS3 e JavaScript Vanilla ES6+ com ES Modules nativos (`<script type="module">`). Proibido: frameworks (React, Vue etc.), pré-processadores e bundlers.
* **Módulos e responsabilidades:**
  * `index.html`: estrutura base; aplica tema e cor de destaque antes da primeira pintura (sem flash).
  * `style.css`: estilos com tokens em `:root`.
  * `src/js/storage.js`: só funções puras de dados e persistência (`localStorage`).
  * `src/js/ui.js`: só criação/atualização do DOM, modais, menus e toasts.
  * `src/js/importExport.js`: parse/stringify do JSON e arquivos (Blob, download, upload, compartilhamento).
  * `src/js/main.js`: ponto de entrada; liga os módulos e registra os eventos.
* **Erros:** `JSON.parse()` e leitura de arquivos sempre em `try/catch`.

## 2. Design System

* **Tokens e fontes:** respeite as variáveis de `:root` (`--background-dark-color`, `--primary-dark-opacity-color`, `--primary-color` etc.) e as fontes `Rajdhani` e `Oswald`. **Cor fixa em CSS é proibida:** use tokens (`--ink-rgb`, `--glow-rgb`, `--face-color`, `--on-face-color`, `--shadow-color`, `--hover-strong-color`, `--overlay-color`...).
* **Ícones de UI:** todos (exceto os ícones dos atalhos) vêm do Google Material Symbols (Outlined) via Google Fonts.
* **Movimento:** easing ease-out/spring; mudanças de layout após render animadas por FLIP (`ui.js`); modais, menus e toasts animam entrada e saída; respeitar `prefers-reduced-motion`.
* **Markup obrigatório** (gerado por `ui.js`):

  ```html
  <section class="divisao" id="ID_TOPICO">
    <div class="topico container">
      <div class="nome-topico">
        <h1>TITULO_DA_PARTICAO</h1>
      </div>
      <div class="sites-grid">
        <div class="site">
          <div class="button">
            <a href="URL_SITE" target="_blank"><!-- ÍCONE --></a>
          </div>
          <h2 class="site-name">NOME_SITE</h2>
        </div>
      </div>
    </div>
  </section>
  ```

  * `ÍCONE` = `<img>` (favicon) | `<span class="marca-svg"><svg>` (marca) | `<span class="material-symbols-outlined site-glifo">` (escolhido). Ver §5.
  * `.site-name` começa com `opacity: 0` e aparece no hover: `.site:hover .site-name { opacity: 1; }`.
  * Partições vazias: renderizadas por último, minimizadas e translúcidas. Órfãos: um grid único no topo, sem cabeçalho nem partição placeholder.
* **Navegação:** `.nav-links` (dentro de `.nav-shell`, trilha arredondada sem outline branco) renderiza `<li><a class="nav-link" href="#ID_TOPICO">TITULO</a></li>`. Overflow: fade nas pontas + setas com contador; roda do mouse e setas rolam na horizontal com suavidade; a partição no topo da tela recebe `li.ativo`.

## 3. Temas (modo + cor de destaque)

* **Modo:** `:root[data-theme="light"]` inverte a paleta (fundo `#ECECEC`, tiles escuros, header/modais claros). Sem escolha salva, segue `prefers-color-scheme` ("Sistema"). A troca anima via `.tema-trocando`.
* **Cor de destaque** (`:root[data-accent]`; `ui.js` define `--accent`, `--accent-rgb`, `--accent-on`): substitui o branco (escuro) / grafite (claro) em `--primary-color`, `--ink-rgb`, `--glow-rgb`, `--tile-color`/`--duo-paper`, `--face-color` e no botão '+'. Texto e tons secundários derivam via `color-mix` (texto = 80% cor + `--accent-default`). Fundo, modais e vermelho de perigo não mudam.
* **Paleta (15):** Padrão (branco/grafite) + cinza, vermelho, laranja, âmbar, amarelo, lima, verde, esmeralda, ciano, azul, índigo, violeta, rosa, magenta, todas com contraste ≥ 3:1 nos dois modos.
* **Contraste:** WCAG cor × fundo do modo (`#202020` / `#ECECEC`) < 3:1 ao escolher a cor → troca o modo + toast ("Cor muito escura para o modo escuro — mudamos para o modo claro" e vice-versa). Ilegível nos dois → modo de maior contraste. Modo incompatível forçado (ou "Sistema" trocado pelo SO): permitido; a cor exibida é clareada/escurecida mantendo o matiz até 3:1 (o valor salvo não muda).
* **Tons dos ícones dos atalhos:** `--duo-ink` (fundo), `--duo-mid` (meio-tom), `--duo-paper` (tile); acompanham tema e cor.
* **Modal "Temas"** (torre do '+'): segmentado Escuro / Claro / Sistema + grade das 15 cores + hex. Pré-visualização ao vivo; "Salvar" grava; Cancelar/Esc/×/clique fora revertem.
  * Hex: campo de texto + amostra redonda que é um `<input type="color">` nativo, sincronizados. Aceita `#RGB`/`#RRGGBB`, com ou sem `#`, sem alpha; vazio = Padrão. 6 dígitos pré-visualizam ao digitar; 3 dígitos só ao confirmar. Inválido → erro de validação (§8). Seletor nativo: arrastar só pré-visualiza; a troca de modo é conferida ao fechar.

## 4. Dados (`localStorage`)

* **Chave:** `utilit_data`. Primeira visita: estado zero (sem partições nem dados padrão).
* **Schema:**

  ```json
  {
    "version": "1.0",
    "topics": [
      {
        "id": "divisao1",
        "title": "Divisão 1",
        "sites": [
          { "id": "site_1", "name": "Google", "url": "https://www.google.com", "icon": "home", "brand": "google" }
        ]
      }
    ],
    "orphans": [],
    "settings": { "theme": "dark", "accent": "#3b7ef0" }
  }
  ```

  * `icon` (Material Symbol) e `brand` (slug do thesvg) são opcionais. `brand: null` = já procurado, sem marca; ausente = ainda não resolvido.
  * `settings.theme`: `'dark'` | `'light'` | ausente (Sistema). `settings.accent`: `#rrggbb` normalizado | ausente (Padrão).
* **IDs:** partição = slug do título, com sufixo numérico se já existir (`divisao-1`, `divisao-1-2`); site = `site_<timestamp>`.
* **URLs:** sem protocolo → prefixa `https://`; validada com `new URL()`. Inválida ou duplicada na mesma partição → bloqueada.
* **Regra geral de duplicata (mesma URL no destino):** o atalho que chega (movido, arrastado ou importado) substitui o existente, inclusive `icon`/`brand`.

## 5. Ícones dos Atalhos

* **Prioridade:** `icon` (Material Symbol escolhido) > `brand` (SVG do thesvg.org) > favicon.
* **thesvg.org:** manifesto `https://thesvg.org/api/registry.json` (~1,9 MB); SVG em `https://thesvg.org/icons/{slug}/{variante}.svg`, preferindo `mono` (sem mono, `default`). Casamento: hostname igual ao domínio da home oficial da marca (subdomínio herda o domínio-pai), depois nome do domínio igual a slug/alias.
  * Sanitizado (sem scripts, eventos, links ou `url()` externos), IDs prefixados por marca, cores mapeadas para no máximo 3 tons do tema. Falha ao carregar → favicon, sem alterar o dado salvo.
  * Marca resolvida ao salvar e gravada em `brand`. O manifesto só é baixado ao abrir o modal de atalho, ao salvar ou para migrar atalhos sem `brand` (em segundo plano, ao abrir a página e após importar).
* **Favicon (fallback):** `https://www.google.com/s2/favicons?domain={DOMAIN}&sz=128`, exibido a 64px em silhueta de 2 cores (filtro SVG `utilit-duo`). Se falhar: `./assets/icone-site.png`.
* **Campo "Ícone" do modal de atalho:** busca única em duas seções, Marcas (thesvg) e Ícones (Material Symbols, lista baixada sob demanda; a busca aceita português). "Automático" volta ao casamento por domínio. Escolha manual grava `brand` ou `icon`; sem a lista de símbolos, aceita o nome exato.

## 6. Portabilidade (`importExport.js`)

* **Exportar:** download automático de `utilit-backup.json` com o estado atual (inclui `icon`, `brand` e `settings`).
* **Importar:** aceita só `.json` e `.txt`, validados pelo mesmo `parseBackup` (exige `version` e `topics`; BOM inicial removido antes do `JSON.parse`). Outra extensão ou estrutura inválida → erro.
  * Modal: área "clique ou arraste o arquivo" que mostra nome e tamanho do arquivo escolhido.
  * **Merge:** partição de mesmo nome → título/ID do backup + sites mesclados (antigos ausentes no backup são preservados); órfãos somados com dedupe por URL; mesma URL → regra geral de duplicata (§4). Tema e cor de destaque atuais NÃO são sobrescritos.
* **Compartilhar:** Web Share API com `utilit-backup.txt` (`text/plain`, mesmo conteúdo JSON; Chrome/Edge não compartilham `.json`), suporte detectado com `navigator.canShare({ files })`. No mesmo clique, baixa antes o `utilit-backup.json`. Cancelar o menu nativo é silencioso; sem suporte ou com erro → modal de reserva.
  * **Reserva:** "Abrir WhatsApp Web" (`https://wa.me/?text=`) e "Abrir Gmail" (`https://mail.google.com/mail/?view=cm`), só texto (link não aceita anexo), com instrução para anexar o arquivo baixado.

## 7. Interações

* **Botão '+':** mesma silhueta dos atalhos; no hover/aberto fica redondo e brilhando, e o '+' gira até virar '×'. Abre uma torre vertical com ícones:
  Nova partição · Novo atalho · — · Importar backup · Exportar backup · Compartilhar backup (`share`; sem partições nem órfãos → toast "Nada para compartilhar ainda") · — · Temas (`palette`).
* **Long-press / botão direito → engrenagem:** long-press de 500 ms (pointer events; cancela ao mover > 10 px; suprime a navegação do link). Botão direito faz o mesmo sem esperar (suprime o menu nativo; ignorado durante arraste). A engrenagem é uma "gota" que desgruda do elemento (mesma substância, borda de 2px, filtro SVG goo) e volta para ele ao sumir. Ao tocar nela, as ações (Editar / Mover atalhos / Excluir) empilham em cima.
* **Partições:**
  * Criar, renomear e excluir. Nome já existente ao criar/renomear → mescla automaticamente (sem duplicar; abre a existente).
  * Excluir: confirmação com a checkbox **"Exclua também os seus atalhos"** (marcada por padrão; desmarcada = atalhos viram órfãos). Vale também para partições excluídas pela lixeira.
  * Mover atalhos (engrenagem da partição): modal com select de destino (outras partições + "Sem partição (órfãos)").
* **Atalhos:** criar, editar, mover e excluir. Modal: select de partição com "Nenhuma"; nome opcional (vazio usa o domínio).
* **Arrastar e soltar (mouse, botão esquerdo):**
  * Mover > 10 px com o botão pressionado inicia o arraste (parado, o long-press continua abrindo a engrenagem).
  * Atalhos: soltar sobre partição move; entre atalhos insere na posição; a faixa "Solte aqui para deixar sem partição" aparece sob o cabeçalho durante o arraste; soltar na seção de órfãos também vale.
  * Partições: arrastar pelo título reordena; vazias sempre no fim.
  * Esc cancela; auto-scroll perto das bordas da tela.
* **Seleção múltipla:** Ctrl+clique alterna seleção (selo ✓ no canto) e não abre o link. Arrastar item selecionado leva todos; não selecionado leva só ele. Atalhos e partições não se misturam. Clicar fora ou Esc limpa a seleção.
* **Lixeira flutuante:** `position: fixed`, abaixo do header, à direita (`top: header + 10px; right: 20px`). Aparece com fade com 1+ itens selecionados ou durante um arraste; some ao limpar a seleção. Clicar abre a confirmação (tom de perigo); nunca exclui direto. Escopo: atalhos e partições selecionados.

## 8. Modais e Toasts

* **Modais:** sobrepostos, fundo `var(--primary-dark-opacity-color)` com `backdrop-filter` e borda em token (`--ink-rgb`), nos dois temas. Cabeçalho com ícone e botão fechar. Erro de validação aparece acima dos botões e o modal balança. Confirmações de exclusão usam tom vermelho.
* **Toasts:** um por vez, na base da tela; com um modal aberto, aparecem no topo.

## 9. Workflow de Desenvolvimento e Triagem

* Novas features ou mudanças de regra de negócio: siga o protocolo de `grill-me-triage.md` (sabatina → append das decisões em `triagem.txt`, na raiz e ignorado pelo git → confirmação antes de implementar).
* Consolidação: `refine-triage.md` sintetiza o `triagem.txt` e, com aprovação do usuário, injeta as regras neste arquivo.
* Este arquivo só é alterado com autorização explícita do usuário.
