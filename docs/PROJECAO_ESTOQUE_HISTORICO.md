# Histórico da Projeção de Estoque

## Objetivo

Registrar snapshots da projeção de estoque (projeção + real) no **Neon (Postgres)** para consulta e comparação ao longo do tempo.

## Salvamento automático

O histórico é gravado **automaticamente** para manter um **histórico real do estoque**: cada mês fica fixo no passado e o atual só é gravado quando “fechar” (primeira carga do mês seguinte).

- **Uma vez por mês:** na **primeira vez** que a Projeção de Estoque é carregada naquele mês (para aquele `company`/`filial`), o backend grava um snapshot. De preferência no dia 1; se a primeira abertura for em outro dia (ex.: dia 5), o snapshot é gravado nesse dia e o mês fica registrado assim.
- **Mês anterior não é alterado:** o primeiro dia do mês passado (ou o snapshot já salvo do mês passado) não afeta a coluna do mês passado — cada snapshot é do “mês atual” na hora em que foi salvo; depois vira histórico.
- Assim o estoque mais antigo possível fica salvo no mês anterior para comparação com os atuais que continuam se modificando.

## Exibição: estoque real vs snapshot

- **Enquanto estamos no mês:** na coluna do mês atual, o **estoque real** e a **duração real** são sempre os valores **ao vivo** (atualizados a cada carga). O snapshot desse mês é gravado em background na primeira abertura do mês, mas **não é exibido** na coluna atual — a coluna atual mostra só o dado mais recente.
- **Ao virar o mês:** nas colunas dos **meses já fechados**, o sistema passa a exibir o **estoque real** e a **duração real** que estavam no snapshot daquele mês (ex.: estoque do dia do snapshot em janeiro). Assim dá para comparar quanto evoluiu: o valor “congelado” do mês passado vs o valor atual do mês corrente.
- Resumo: snapshot do mês atual fica guardado e só aparece quando o mês virar; durante o mês, o real segue atualizando.

O botão **"Salvar snapshot no histórico"** continua disponível como **opcional** para gravar em outro momento se quiser.

## Tabela (Neon/Postgres)

- **Nome:** `projecao_estoque_historico`
- **Criação:** Execute uma vez o script `scripts/create-projecao-estoque-historico.sql` no Neon. A aplicação também pode criar a tabela automaticamente no primeiro uso (`CREATE TABLE IF NOT EXISTS`).
- **Campos principais:** `snapshot_date`, `company`, `filial`, `categoria`, `linha`, `subgrupo`, `grade`, `colecao`, `ano`, `mes`, `vendas_projetada`, `vendas_real`, `estoque_projetado`, `estoque_real`, `duracao_projetada`, `duracao_real`, `created_at`.

## Uso

1. **Automático:** ao abrir a Projeção de Estoque, o backend verifica se já existe snapshot no mês atual para aquele company/filial. Se não existir (ex.: primeira abertura do mês, idealmente dia 1), grava um snapshot. Só grava uma vez por mês.
2. **Manual (opcional):** use o botão **"Salvar snapshot no histórico"** para gravar na data atual quando quiser.
3. **Consultar histórico:** API `GET /api/controle-estoque/projecao-historico?company=...&filial=...` para listar datas; `&snapshot_date=YYYY-MM-DD` para dados daquele dia; `&categoria=...` para histórico da categoria.

## API

- **POST** `/api/controle-estoque/projecao-historico`  
  Body: `{ company, filial?, grupos?, linhas?, colecoes?, subgrupos?, grades? }`  
  Rebusca a projeção com esses filtros e grava no banco (snapshot_date = hoje).  
  Resposta: `{ success, saved, snapshot_date }`.

- **GET** `/api/controle-estoque/projecao-historico?company=...&filial=?`  
  Retorna a lista de `snapshot_date` disponíveis.

- **GET** `...?company=...&snapshot_date=YYYY-MM-DD`  
  Retorna todos os registros daquele snapshot.

- **GET** `...?company=...&categoria=...&limit=24`  
  Retorna o histórico da categoria (últimos snapshots).
