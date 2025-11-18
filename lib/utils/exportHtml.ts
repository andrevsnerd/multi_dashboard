/**
 * Exporta o conteúdo HTML de um elemento para um arquivo HTML completo
 * incluindo todos os estilos computados e CSS aplicados
 */

interface ExportOptions {
  filename?: string;
  title?: string;
}

/**
 * Obtém todos os estilos computados de um elemento e seus filhos recursivamente
 */
function getElementStyles(element: HTMLElement): string {
  const styles: string[] = [];
  const computedStyles = window.getComputedStyle(element);
  
  // Converter estilos computados para CSS inline
  let inlineStyles = '';
  for (let i = 0; i < computedStyles.length; i++) {
    const prop = computedStyles[i];
    const value = computedStyles.getPropertyValue(prop);
    inlineStyles += `${prop}: ${value}; `;
  }
  
  return inlineStyles.trim();
}

/**
 * Clona um elemento e aplica estilos inline em todos os nós
 */
function cloneElementWithStyles(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  
  // Função recursiva para aplicar estilos
  function applyStyles(node: Node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const originalEl = element.querySelector(`[data-export-id="${el.getAttribute('data-export-id')}"]`) as HTMLElement;
      
      if (!originalEl) {
        // Aplicar estilos diretamente
        const computedStyles = window.getComputedStyle(el);
        let inlineStyles = '';
        for (let i = 0; i < computedStyles.length; i++) {
          const prop = computedStyles[i];
          const value = computedStyles.getPropertyValue(prop);
          
          // Ignorar propriedades que não são necessárias ou causam problemas
          if (
            prop === 'width' && value === 'auto' ||
            prop === 'height' && value === 'auto' ||
            prop.startsWith('transition') ||
            prop.startsWith('animation') ||
            prop === 'pointer-events' ||
            prop === 'cursor'
          ) {
            continue;
          }
          
          inlineStyles += `${prop}: ${value}; `;
        }
        el.setAttribute('style', inlineStyles);
      }
      
      // Adicionar ID temporário para rastreamento
      if (!el.hasAttribute('data-export-id')) {
        el.setAttribute('data-export-id', Math.random().toString(36).substr(2, 9));
      }
      
      // Processar filhos
      Array.from(el.childNodes).forEach(applyStyles);
    }
  }
  
  // Primeiro, adicionar IDs temporários ao original
  function addExportIds(node: Node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (!el.hasAttribute('data-export-id')) {
        el.setAttribute('data-export-id', Math.random().toString(36).substr(2, 9));
      }
      Array.from(el.childNodes).forEach(addExportIds);
    }
  }
  
  addExportIds(element);
  applyStyles(clone);
  
  return clone;
}

/**
 * Obtém todas as regras CSS de todas as folhas de estilo
 */
function getAllCssRules(): string {
  let cssText = '';
  
  // Coletar estilos de todas as folhas de estilo
  for (let i = 0; i < document.styleSheets.length; i++) {
    try {
      const sheet = document.styleSheets[i];
      
      // Pular folhas de estilo de outros domínios (CORS)
      if (sheet.href && !sheet.href.startsWith(window.location.origin) && !sheet.href.startsWith('/')) {
        continue;
      }
      
      const rules = sheet.cssRules || sheet.rules;
      if (rules) {
        for (let j = 0; j < rules.length; j++) {
          const rule = rules[j];
          if (rule instanceof CSSStyleRule || rule instanceof CSSMediaRule) {
            cssText += rule.cssText + '\n';
          }
        }
      }
    } catch (e) {
      // Ignorar erros de CORS
      console.warn('Não foi possível acessar folha de estilo:', e);
    }
  }
  
  return cssText;
}

/**
 * Obtém estilos computados importantes de um elemento
 */
function getComputedStylesString(element: HTMLElement): string {
  const computedStyles = window.getComputedStyle(element);
  const importantStyles: string[] = [];
  
  // Lista de propriedades importantes a preservar
  const importantProperties = [
    'display', 'position', 'flex-direction', 'justify-content', 'align-items',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-radius', 'border-width', 'border-style', 'border-color',
    'background', 'background-color', 'background-image', 'background-size',
    'color', 'font-size', 'font-weight', 'font-family', 'line-height',
    'text-align', 'text-transform', 'text-decoration', 'letter-spacing',
    'white-space', 'overflow', 'overflow-x', 'overflow-y',
    'z-index', 'opacity', 'box-shadow', 'box-sizing',
    'gap', 'grid-template-columns', 'grid-template-rows',
    'flex', 'flex-grow', 'flex-shrink', 'flex-basis',
    'cursor', 'user-select'
  ];
  
  for (const prop of importantProperties) {
    try {
      const value = computedStyles.getPropertyValue(prop);
      if (value && value !== 'initial' && value !== 'normal') {
        // Não incluir propriedades de transição/animação
        if (!prop.startsWith('transition') && !prop.startsWith('animation')) {
          importantStyles.push(`${prop}: ${value};`);
        }
      }
    } catch (e) {
      // Ignorar erros
    }
  }
  
  // Incluir propriedades específicas calculadas
  if (element instanceof HTMLElement) {
    const scrollWidth = element.scrollWidth;
    const scrollHeight = element.scrollHeight;
    const clientWidth = element.clientWidth;
    const width = computedStyles.width;
    const height = computedStyles.height;
    
    // Preservar largura se definida
    if (width && width !== 'auto') {
      importantStyles.push(`width: ${width};`);
    }
    
    if (height === 'auto' && scrollHeight > 0 && element.scrollHeight !== element.clientHeight) {
      // Só adicionar se houver overflow
    }
  }
  
  return importantStyles.join(' ');
}

/**
 * Aplica estilos inline em todos os elementos do clone
 */
function applyInlineStyles(element: HTMLElement, clonedElement: HTMLElement): void {
  // Processar o elemento raiz - preservar estilos originais
  const rootStyle = getComputedStylesString(element);
  clonedElement.setAttribute('style', rootStyle);
  
  // Processar todos os elementos filhos recursivamente
  function processElement(originalEl: HTMLElement, clonedEl: HTMLElement) {
    const computedStyle = getComputedStylesString(originalEl);
    
    if (computedStyle) {
      const existingStyle = clonedEl.getAttribute('style') || '';
      clonedEl.setAttribute('style', `${existingStyle} ${computedStyle}`.trim());
    }
    
    // Processar filhos
    const originalChildren = Array.from(originalEl.children) as HTMLElement[];
    const clonedChildren = Array.from(clonedEl.children) as HTMLElement[];
    
    for (let i = 0; i < originalChildren.length && i < clonedChildren.length; i++) {
      processElement(originalChildren[i], clonedChildren[i]);
    }
  }
  
  const originalChildren = Array.from(element.children) as HTMLElement[];
  const clonedChildren = Array.from(clonedElement.children) as HTMLElement[];
  
  for (let i = 0; i < originalChildren.length && i < clonedChildren.length; i++) {
    processElement(originalChildren[i], clonedChildren[i]);
  }
}

/**
 * Exporta um elemento HTML para um arquivo HTML completo
 */
export function exportElementToHtml(
  element: HTMLElement,
  options: ExportOptions = {}
): void {
  const {
    filename = `dashboard-export-${new Date().toISOString().split('T')[0]}.html`,
    title = 'Dashboard Export'
  } = options;
  
  // Clonar o elemento
  const clonedElement = element.cloneNode(true) as HTMLElement;
  
  // Remover botão de exportação HTML especificamente (não todos os botões)
  const exportButton = clonedElement.querySelector('button[title="Exportar dashboard em HTML"]');
  if (exportButton) {
    exportButton.remove();
  }
  
  // Remover checkbox "Mostrar itens sem vendas" mas manter o label
  const checkboxRow = clonedElement.querySelector('.filterRow');
  if (checkboxRow) {
    const checkbox = checkboxRow.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.remove();
    }
  }
  
  // Converter botões de ação na tabela para texto simples
  const actionButtons = clonedElement.querySelectorAll('.actionButton');
  actionButtons.forEach(btn => {
    const td = btn.closest('td');
    if (td) {
      td.textContent = btn.textContent || '';
    }
  });
  
  // Aplicar estilos inline
  applyInlineStyles(element, clonedElement);
  
  // Obter HTML do clone
  const htmlContent = clonedElement.outerHTML;
  
  // Obter CSS de todas as folhas de estilo
  const cssRules = getAllCssRules();
  
  // Criar documento HTML completo
  const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * {
      box-sizing: border-box;
    }
    
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      background: #f8fafc;
      color: #1f2937;
      overflow-x: auto;
    }
    
    body {
      padding: 32px;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    
    /* Container principal centralizado */
    body > div:first-child {
      width: 100%;
      max-width: 1400px;
      margin: 0 auto;
    }
    
    ${cssRules}
    
    /* Garantir que tabelas tenham largura adequada */
    table {
      border-collapse: collapse;
      width: 100%;
    }
    
    /* Remover estilos de interação */
    button, input, select {
      pointer-events: none;
    }
    
    /* Media queries para responsividade mobile */
    @media (max-width: 1024px) {
      body {
        padding: 24px 16px;
      }
      
      body > div:first-child {
        max-width: 100%;
      }
      
      /* Ajustar grids para mobile */
      .chartsRow,
      [class*="chartsRow"],
      [class*="grid"] {
        grid-template-columns: 1fr !important;
      }
      
      /* Ajustar flex rows para mobile */
      .headerRow,
      [class*="headerRow"],
      .controls,
      [class*="controls"] {
        flex-direction: column !important;
        align-items: stretch !important;
      }
    }
    
    @media (max-width: 768px) {
      body {
        padding: 16px;
      }
      
      /* Ajustar fontes menores no mobile */
      h1, h2, h3 {
        font-size: clamp(18px, 4vw, 24px) !important;
      }
      
      /* Cards em coluna única no mobile */
      [class*="grid"] {
        grid-template-columns: 1fr !important;
        gap: 16px !important;
      }
    }
    
    @media (max-width: 480px) {
      body {
        padding: 12px;
      }
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;
  
  // Criar blob e fazer download
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

