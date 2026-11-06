# Skill: Refinamento de Triagem (refine-triage)

## 1. Gatilho
Acione sob comando explícito ("refine-triage", "sintetize a triagem", "limpe as regras").

## 2. Protocolo de Refinamento
1. **Leitura cruzada:** Leia o `triagem.txt` inteiro e compare com o `CLAUDE.md`.
2. **Resolução de Conflitos:** Mescle as regras do `triagem.txt`. A regra mais recente sempre anula a anterior (ex: se o destino de órfãos mudou, mantenha só a versão final).
3. **Filtro Estrito:** Remova qualquer regra que já conste no `CLAUDE.md` com a mesma lógica.
4. **Síntese:** Gere um bloco Markdown ultra-enxuto com as conclusões finais.

## 3. Ação no Sistema
1. **Substitua** (não anexe) todo o conteúdo do arquivo `triagem.txt` apenas por este novo bloco sintetizado.
2. Exiba o bloco no chat e aguarde a aprovação do usuário para injetar as novidades no `CLAUDE.md`.