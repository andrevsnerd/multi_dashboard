/**
 * Normalização de textos do Controle Financeiro (descrição, classificação, loja…).
 *
 * O dado da planilha NUNCA é alterado: a forma normalizada fica em colunas `*_fmt`
 * e é só para leitura/agrupamento. A comparação entre versões da planilha continua
 * no texto cru.
 *
 * Regra de ouro: só unifica o que é CERTAMENTE a mesma coisa.
 *  1. Formatação (sempre, e para qualquer texto novo): espaços, caixa padrão
 *     (Título, com conectivos em minúsculas e siglas em maiúsculas), separadores.
 *  2. Acentuação de palavras comuns (cartao → cartão): lista fechada abaixo, sem
 *     palavras que mudam de sentido com o acento (e/é, marco/março, sa/sá…).
 *  3. Erros de digitação de PALAVRAS (transpote → transporte): dicionário curado à
 *     mão a partir da planilha. Nada de similaridade automática — ela juntaria
 *     "bolha"/"folha", "festa"/"cesta", "gabriel"/"gabriela".
 *  4. Unificação de VALORES inteiros por campo (higienoplis → Higienópolis): curada.
 *
 * Regras aprovadas na tela (tabela financeiro_normalizacao) entram por cima das
 * daqui, no mesmo formato. Texto novo que não casa com nenhuma regra só é formatado.
 */

export const CAMPOS_NORMALIZADOS = [
  "descricao",
  "classificacao",
  "loja",
  "matriz",
  "forma_pgto",
  "cliente",
  "colecao",
] as const;
export type CampoNormalizado = (typeof CAMPOS_NORMALIZADOS)[number];

export const ROTULO_CAMPO_NORMALIZADO: Record<CampoNormalizado, string> = {
  descricao: "Descrição",
  classificacao: "Classificação",
  loja: "Loja / Shopping",
  matriz: "Matriz",
  forma_pgto: "Forma de pgto",
  cliente: "Cliente",
  colecao: "Coleção",
};

/** Chave de comparação: sem acento, minúscula, espaços colapsados. */
export function chaveTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------ vocabulário */

/** Sempre em maiúsculas (siglas, impostos, códigos de matriz, UFs). */
const SIGLAS = new Set(
  (
    "icms das irpj csll pis cofins iss iof inss fgts darf iptu ipva ipi gps dctf difal gnre st " +
    "nf nfe nfs nfse cnpj cpf cnh rg adm rh ti vr vt va plr pj clt mei ecad pcmso aso cipa epi sesmt nr " +
    "spc ted doc pix sms uv led tv dvd usb pc cd ia epp cmv dre crc oab cef bb " +
    "drr fsz rsr jjj rjr fff lll jrr frs msc fffr ffffr csm jk gru lon vff mbm ppi " +
    "sp rj bh mg rs pr sc ba pe df mt ms rn pb ro rr cbmerj mac gb nv rk pct ok ir cs nk masp"
  ).split(" ")
);

/** Siglas que só valem num campo (em descrição "pos" pode ser "pós"). */
const SIGLAS_POR_CAMPO: Partial<Record<CampoNormalizado, Set<string>>> = {
  forma_pgto: new Set(["pos", "tef", "pdv"]),
};

/** Unidades de medida: sempre minúsculas. */
const UNIDADES = new Set("kg g cm mm ml m2 m3 un".split(" "));

/** Minúsculas no meio do texto. */
const CONECTIVOS = new Set(
  "de da do das dos e em no na nos nas a o as os ao aos à às com para por pra pro x ou sem sob p c via".split(" ")
);

/** Grafia exata (marcas com caixa própria). */
const GRAFIAS: Record<string, string> = {
  whatsapp: "WhatsApp",
  whats: "Whats",
  iphone: "iPhone",
  ipad: "iPad",
  macbook: "MacBook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  paypal: "PayPal",
  ifood: "iFood",
  pagseguro: "PagSeguro",
  itau: "Itaú",
  scarfme: "Scarf Me",
  ecommerce: "E-commerce",
};

/** Acentuação de palavras comuns (chave sem acento → forma correta). */
const ACENTOS: Record<string, string> = Object.fromEntries(
  (
    "bancaria:bancária bancarias:bancárias bancario:bancário bancarios:bancários premiacao:premiação premiacoes:premiações " +
    "cartao:cartão cartoes:cartões refeicao:refeição refeicoes:refeições mes:mês medico:médico medica:médica medicos:médicos " +
    "manutencao:manutenção manutencoes:manutenções comissao:comissão comissoes:comissões rescisao:rescisão rescisoes:rescisões " +
    "mao:mão maos:mãos jose:josé devolucao:devolução devolucoes:devoluções cartorio:cartório cartorios:cartórios " +
    "higienopolis:higienópolis cafe:café cafes:cafés credito:crédito creditos:créditos debito:débito debitos:débitos " +
    "pedagio:pedágio pedagios:pedágios galeao:galeão lenco:lenço lencos:lenços producao:produção producoes:produções " +
    "previsao:previsão escritorio:escritório escritorios:escritórios alemao:alemão reuniao:reunião reunioes:reuniões " +
    "impressao:impressão impressoes:impressões emissao:emissão almoco:almoço almocos:almoços renovacao:renovação " +
    "mae:mãe maes:mães botao:botão botoes:botões importacao:importação importacoes:importações alteracao:alteração " +
    "alteracoes:alterações andre:andré consignacao:consignação implantacao:implantação confraternizacao:confraternização " +
    "amarracao:amarração amarracoes:amarrações alimentacao:alimentação alvara:alvará alvaras:alvarás ate:até " +
    "maranhao:maranhão edicao:edição padrao:padrão pao:pão paes:pães leilao:leilão papelao:papelão suica:suíça " +
    "fusao:fusão sera:será calcada:calçada uniao:união adocante:adoçante exportacao:exportação seguranca:segurança " +
    "parana:paraná grao:grão salario:salário salarios:salários ferias:férias beneficio:benefício beneficios:benefícios " +
    "condominio:condomínio condominios:condomínios servico:serviço servicos:serviços agua:água contabil:contábil " +
    "contabeis:contábeis tecnico:técnico tecnica:técnica juridico:jurídico juridica:jurídica eletrica:elétrica " +
    "eletrico:elétrico eletricos:elétricos eletronico:eletrônico eletronicos:eletrônicos maquina:máquina maquinas:máquinas " +
    "mutuo:mútuo emprestimo:empréstimo emprestimos:empréstimos antecipacao:antecipação antecipacoes:antecipações " +
    "transferencia:transferência transferencias:transferências mostruario:mostruário mostruarios:mostruários " +
    "funcionario:funcionário funcionarios:funcionários funcionaria:funcionária funcionarias:funcionárias convenio:convênio " +
    "convenios:convênios deposito:depósito depositos:depósitos cobranca:cobrança cobrancas:cobranças comercio:comércio " +
    "estagio:estágio estagiario:estagiário estagiaria:estagiária estagiarios:estagiários veiculo:veículo veiculos:veículos " +
    "onibus:ônibus combustivel:combustível saude:saúde odontologico:odontológico vestuario:vestuário plastico:plástico " +
    "plasticos:plásticos acrilico:acrílico acrilicos:acrílicos lampada:lâmpada lampadas:lâmpadas fotografo:fotógrafo " +
    "fotografa:fotógrafa grafica:gráfica graficas:gráficas numero:número numeros:números taxi:táxi inventario:inventário " +
    "licenca:licença licencas:licenças midia:mídia midias:mídias video:vídeo videos:vídeos unico:único unica:única " +
    "ultimo:último ultima:última proximo:próximo proxima:próxima periodo:período operacao:operação operacoes:operações " +
    "instalacao:instalação instalacoes:instalações homologacao:homologação criacao:criação criacoes:criações " +
    "composicao:composição variacao:variação acao:ação acoes:ações informacao:informação aquisicao:aquisição " +
    "locacao:locação comunicacao:comunicação contribuicao:contribuição distribuicao:distribuição retencao:retenção " +
    "restituicao:restituição admissao:admissão demissao:demissão socio:sócio socios:sócios socia:sócia socias:sócias " +
    "irmao:irmão irmaos:irmãos crianca:criança criancas:crianças aereo:aéreo aerea:aérea aereas:aéreas sao:são " +
    "joao:joão goias:goiás brasilia:brasília ribeirao:ribeirão petropolis:petrópolis florianopolis:florianópolis " +
    "niteroi:niterói analise:análise analises:análises fisica:física estrategia:estratégia logistica:logística " +
    "logistico:logístico basica:básica basicas:básicas basico:básico basicos:básicos pratica:prática farmacia:farmácia " +
    "agencia:agência agencias:agências anuncio:anúncio anuncios:anúncios negocio:negócio negocios:negócios " +
    "premio:prêmio premios:prêmios dolar:dólar dolares:dólares cambio:câmbio consultorio:consultório " +
    "laboratorio:laboratório colecao:coleção colecoes:coleções verao:verão liquido:líquido diaria:diária " +
    "diarias:diárias tributario:tributário tributaria:tributária patrimonio:patrimônio " +
    "provisoria:provisória provisorio:provisório juridicos:jurídicos aguas:águas lindoia:lindóia " +
    "orcamento:orçamento orcamentos:orçamentos fiscalizacao:fiscalização regularizacao:regularização " +
    "contratacao:contratação manifestacao:manifestação divulgacao:divulgação decoracao:decoração " +
    "relogio:relógio relogios:relógios atencao:atenção correcao:correção " +
    "variavel:variável variaveis:variáveis util:útil uteis:úteis excecao:exceção sessao:sessão comemoracao:comemoração doacao:doação doacoes:doações " +
    "estacao:estação divida:dívida dividas:dívidas acessorios:acessórios acessorio:acessório pre:pré " +
    "movel:móvel moveis:móveis proximos:próximos proximas:próximas"
  )
    .split(" ")
    .map((p) => p.split(":") as [string, string])
);

/**
 * Erros de digitação em PALAVRAS, revisados um a um na planilha (14/10/2026).
 * Só entra palavra que não existe com outro sentido; nomes de pessoas ficam de fora.
 */
const CORRECOES: Record<string, string> = Object.fromEntries(
  (
    "salet:salete pemiacao:premiação permiacao:premiação despeas:despesas despess:despesas desepesas:despesas " +
    "cajamara:cajamar cajamaar:cajamar catao:cartão cartaqo:cartão cartaos:cartões transposrte:transporte " +
    "transpote:transporte tranporte:transporte trasporte:transporte transprote:transporte transpsorte:transporte " +
    "trasnporte:transporte transrporte:transporte tarnsporte:transporte tranpsorte:transporte osccar:oscar " +
    "fretre:frete freete:frete ferte:frete alugel:aluguel alguel:aluguel alugue:aluguel mesal:mensal " +
    "rfeicao:refeição mototoy:motoboy moboboy:motoboy motoby:motoboy motooy:motoboy danieal:daniel daniiel:daniel " +
    "lilmpeza:limpeza limpeja:limpeza llimpeza:limpeza complelento:complemento complmento:complemento " +
    "complememto:complemento complemeto:complemento complemeneto:complemento complemnto:complemento " +
    "depesa:despesa desepesa:despesa converio:convênio tariifa:tarifa tariafa:tarifa materal:material " +
    "meterial:material materila:material mterial:material matarial:material mateiral:material ateiral:material " +
    "igutemi:iguatemi iguatem:iguatemi amosstra:amostra amostrs:amostra amostar:amostra amotra:amostra " +
    "amotras:amostras manuntencao:manutenção manutenca:manutenção manutencapo:manutenção mautencao:manutenção " +
    "manautencao:manutenção manuitencao:manutenção linxs:linx linkx:linx clinte:cliente cleinte:cliente " +
    "cliene:cliente cliette:cliente clinete:cliente reembolo:reembolso reemboso:reembolso reebolso:reembolso " +
    "pauista:paulista palista:paulista paulsita:paulista comisao:comissão comisssao:comissão resscisao:rescisão " +
    "rescsiao:rescisão rsecisao:rescisão resciscao:rescisão correo:correio cidde:cidade cidae:cidade " +
    "cidadde:cidade domigo:domingo scafme:scarfme scarme:scarfme scarffme:scarfme cooporativo:corporativo " +
    "coporativo:corporativo corpoorativo:corporativo coraporativo:corporativo corporaivo:corporativo " +
    "coorporativo:corporativo coorportivo:corporativo coorportativo:corporativo corportivo:corporativo " +
    "corpotivo:corporativo coportivo:corporativo texil:têxtil textil:têxtil devoluca:devolução devoluco:devolução " +
    "desocnto:desconto descotno:desconto cartoro:cartório evendo:evento etacionamento:estacionamento " +
    "estacionameto:estacionamento estacionametno:estacionamento estacioanamento:estacionamento " +
    "estcionamento:estacionamento sinicato:sindicato etiquetha:etiqueta etiquetal:etiqueta eitqueta:etiqueta " +
    "shootig:shooting shoting:shooting shootinh:shooting shoothing:shooting eladorado:eldorado " +
    "vairacao:variação cursto:custo higienipolis:higienópolis higienpolis:higienópolis higienoplis:higienópolis " +
    "higinopolis:higienópolis complemengtar:complementar complemantar:complementar facbook:facebook " +
    "costureia:costureira salaro:salário roaylties:royalties royaltise:royalties royaltes:royalties " +
    "royalities:royalties roylaties:royalties royaklties:royalties royaliyes:royalties royalites:royalties " +
    "traqdaq:tradaq traadaq:tradaq cosutra:costura motitoramento:monitoramento nierd:nerd kaluga:kalunga " +
    "kalumga:kalunga caffe:café drobox:dropbox enterega:entrega credico:crédito modeli:modelo mdelo:modelo " +
    "modele:modelo pedagi:pedágio pedario:pedágio balzar:bazar gaelao:galeão gaeao:galeão produao:produção " +
    "prodrucao:produção alphagrafica:alphagrafics alpahgrafics:alphagrafics aphagrafics:alphagrafics " +
    "alphagrafcs:alphagrafics aplhagrafics:alphagrafics alhagrafics:alphagrafics alphagrafids:alphagrafics " +
    "alphagrfics:alphagrafics vitrie:vitrine subilipaper:sublipaper accao:ação tecotto:tecotton " +
    "computadro:computador premisao:previsão loggo:loggi loogi:loggi escritrorio:escritório escrotorio:escritório " +
    "escritroio:escritório escritrio:escritório servicpo:serviço emprestido:empréstimo ibirapura:ibirapuera " +
    "ibirapurera:ibirapuera passagen:passagem maiol:maio embalatens:embalagens emblagens:embalagens " +
    "emgalagens:embalagens treianmento:treinamento novembor:novembro aviametnos:aviamentos piterest:pinterest " +
    "anteicpacao:antecipação antecipalcao:antecipação etiqutas:etiquetas etiqueas:etiquetas reforna:reforma " +
    "refornma:reforma higjlight:highlight hightight:highlight highilight:highlight fevereio:fevereiro " +
    "shopyfy:shopify arquiei:arquivei desmontagems:desmontagem desmointagem:desmontagem " +
    "credencimento:credenciamento credencimaento:credenciamento prorogada:prorrogada cerfificado:certificado " +
    "certifiado:certificado certiricado:certificado certiticado:certificado ceritificado:certificado " +
    "segurao:seguro padara:padaria merccado:mercado vigem:viagem innvictus:invictus invctus:invictus " +
    "mosturario:mostruário adeivos:adesivos adeisivos:adesivos adessivos:adesivos tonner:toner tooner:toner " +
    "tonners:toners isntalacao:instalação instalcao:instalação montgem:montagem montaem:montagem " +
    "oepracao:operação dufty:dufry lapadas:lâmpadas digial:digital encerrametno:encerramento " +
    "condiciondo:condicionado shoppingl:shopping vericalpack:verticalpack vverticalpack:verticalpack " +
    "vertcalpack:verticalpack multiplam:multiplan birckenstock:birkenstock abertuar:abertura abetura:abertura " +
    "eltrica:elétrica eletgrica:elétrica desensolvimento:desenvolvimento desevnvolvimento:desenvolvimento " +
    "forografo:fotógrafo fotorafo:fotógrafo estamapas:estampas recarca:recarga recarda:recarga diplay:display " +
    "dipslay:display ginana:gincana maqueador:maquiador tecidosn:tecidos sericos:serviços acrililcos:acrílicos " +
    "admicional:adicional spotif:spotify spofty:spotify spoty:spotify spotfy:spotify saquinos:saquinhos " +
    "pilotagam:pilotagem desing:design boetoes:botões funcinaria:funcionária importacoa:importação " +
    "trismestral:trimestral estintores:extintores baner:banner ampanha:campanha adimissional:admissional " +
    "adcmissional:admissional brasspress:braspress telegama:telegrama flolder:folder marcieniro:marceneiro " +
    "marcineiro:marceneiro chaveio:chaveiro registo:registro papael:papel nesresso:nespresso fechaento:fechamento " +
    "fechameto:fechamento impreessos:impressos confraterniazacao:confraternização homologaao:homologação " +
    "sufite:sulfite sufiute:sulfite sufit:sulfite tratametno:tratamento funcionairo:funcionário " +
    "influeincer:influencer creacoes:criações eletrecista:eletricista emrpesa:empresa covide:covid " +
    "envelpe:envelope alimetacao:alimentação alavara:alvará extornado:estornado extorno:estorno " +
    "inernacional:internacional tinhimento:tingimento photorrom:photoroom cotratual:contratual acustia:acústica " +
    "inverntario:inventário indevda:indevida peclas:peças quisosques:quiosques notnook:notebook notbook:notebook " +
    "consccerto:conserto conscerto:conserto manequin:manequim manequins:manequins"
  )
    .split(" ")
    .map((p) => p.split(":") as [string, string])
);

/** Unificação de valores inteiros, por campo (chave do valor → forma canônica). */
const ALIASES: Partial<Record<CampoNormalizado, Record<string, string>>> = {
  loja: {
    higi: "Higienópolis",
    hig: "Higienópolis",
    higienoplis: "Higienópolis",
    higienpolis: "Higienópolis",
    higinopolis: "Higienópolis",
    paulsita: "Paulista",
    paulita: "Paulista",
    pauista: "Paulista",
    guarulho: "Guarulhos",
    gru: "Guarulhos",
    "villa lobos": "Villa Lobos",
    "vila lobos": "Villa Lobos",
    galao: "Galeão",
    acataco: "Atacado",
    "multi marca": "Multimarca",
    oscar: "Oscar Freire",
    jk: "JK Iguatemi",
    barra: "Barra Shopping",
    diamond: "Diamond Mall",
    "ig campinas": "Campinas",
    "cidade sp": "Cidade São Paulo",
  },
};

/* ------------------------------------------------------------- regras */

export type TipoRegra = "palavra" | "valor";

export interface RegraNormalizacao {
  tipo: TipoRegra;
  /** Só para tipo "valor". */
  campo: CampoNormalizado | null;
  /** Chave (chaveTexto) da palavra ou do valor original. */
  de: string;
  para: string;
}

export interface Dicionario {
  palavras: Map<string, string>;
  valores: Map<CampoNormalizado, Map<string, string>>;
}

/** Dicionário embutido + regras aprovadas na tela (as aprovadas vencem). */
export function montarDicionario(extras: RegraNormalizacao[] = []): Dicionario {
  const palavras = new Map<string, string>(Object.entries(CORRECOES));
  const valores = new Map<CampoNormalizado, Map<string, string>>();
  for (const [campo, m] of Object.entries(ALIASES)) {
    valores.set(campo as CampoNormalizado, new Map(Object.entries(m ?? {})));
  }
  for (const r of extras) {
    if (r.tipo === "palavra") palavras.set(chaveTexto(r.de), r.para);
    else if (r.campo) {
      if (!valores.has(r.campo)) valores.set(r.campo, new Map());
      valores.get(r.campo)!.set(chaveTexto(r.de), r.para);
    }
  }
  return { palavras, valores };
}

export const DICIONARIO_PADRAO = montarDicionario();

export function regrasEmbutidas(): RegraNormalizacao[] {
  return [
    ...Object.entries(CORRECOES).map(([de, para]) => ({ tipo: "palavra" as const, campo: null, de, para })),
    ...Object.entries(ALIASES).flatMap(([campo, m]) =>
      Object.entries(m ?? {}).map(([de, para]) => ({
        tipo: "valor" as const,
        campo: campo as CampoNormalizado,
        de,
        para,
      }))
    ),
  ];
}

/* ---------------------------------------------------------- formatação */

const PALAVRA = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;

function capitalizar(p: string): string {
  return p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1);
}

function formatarPalavra(
  original: string,
  primeira: boolean,
  dic: Dicionario,
  campo: CampoNormalizado,
  abreviada = false
): string {
  const lower = original.toLocaleLowerCase("pt-BR");
  const chave = chaveTexto(lower);
  if (campo === "matriz") return original.toLocaleUpperCase("pt-BR");
  if (GRAFIAS[chave]) return GRAFIAS[chave];
  if (SIGLAS.has(chave) || SIGLAS_POR_CAMPO[campo]?.has(chave)) return lower.toLocaleUpperCase("pt-BR");
  if (UNIDADES.has(chave)) return lower;
  const corrigida = dic.palavras.get(chave) ?? ACENTOS[chave] ?? lower;
  if (GRAFIAS[chaveTexto(corrigida)]) return GRAFIAS[chaveTexto(corrigida)];
  // "Com." (comércio) é abreviação, não o conectivo "com".
  if (!primeira && !abreviada && CONECTIVOS.has(chave)) return corrigida;
  return capitalizar(corrigida);
}

/**
 * Forma de leitura de um texto da planilha. Determinística: o mesmo texto cru com
 * o mesmo dicionário dá sempre o mesmo resultado.
 */
export function normalizarTexto(
  valor: string | null | undefined,
  campo: CampoNormalizado,
  dic: Dicionario = DICIONARIO_PADRAO
): string | null {
  if (valor == null) return null;
  let s = String(valor).normalize("NFC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;

  const alias = dic.valores.get(campo)?.get(chaveTexto(s));
  if (alias) return alias;

  // Número solto (valor digitado na coluna errada) fica como está.
  if (/^-?[\d.,]+$/.test(s)) return s;

  s = s
    .replace(/\s*[-–—]\s*$/g, "") // "ICMS -" → "ICMS"
    .replace(/\s+([,;:)])/g, "$1") // "a , b" → "a, b"
    .replace(/\(\s+/g, "(")
    .replace(/,(?=[A-Za-zÀ-ÖØ-öø-ÿ])/g, ", ") // "a,b" → "a, b" (não mexe em "793,74")
    .replace(/\s+[-–—]\s*|\s*[-–—]\s+/g, " - ") // separador com espaço de um lado só
    .trim();

  let primeira = true;
  s = s.replace(PALAVRA, (palavra, pos: number) => {
    // Conta como início se for o começo do texto ou vier depois de " - " / "(" / "/".
    const antes = s.slice(0, pos);
    const inicio = primeira || /(\s-\s|[(:/]\s*)$/.test(antes);
    primeira = false;
    const abreviada = s.charAt(pos + palavra.length) === ".";
    return formatarPalavra(palavra, inicio, dic, campo, abreviada);
  });

  // Locuções certas.
  s = s
    .replace(/(^|\s)a vista\b/gi, (_m, esp: string, pos: number, todo: string) => {
      // Mesma regra de início de frase das palavras: começo do texto ou depois de " - ".
      const inicio = pos === 0 || /(\s-|[(:/])\s*$/.test(todo.slice(0, pos + esp.length));
      return `${esp}${inicio ? "À" : "à"} Vista`;
    })
    .replace(/\be-commerce\b/gi, "E-commerce");

  // Unificação de valor também depois da formatação (ex.: "Higienoplis" já corrigido).
  return dic.valores.get(campo)?.get(chaveTexto(s)) ?? s;
}
