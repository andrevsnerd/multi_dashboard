/**
 * Script para configurar permissões padrão do usuário "logistica"
 * 
 * Execute este script após o deploy ou localmente para configurar as permissões:
 * npx tsx scripts/setup-logistica-permissoes.ts
 */

import { savePermissao } from '@/lib/utils/transferencia-permissoes-store';

async function setupLogisticaPermissoes() {
  try {
    console.log('Configurando permissões para o usuário "logistica"...');

    // Buscar filiais para identificar os códigos corretos
    const filiaisResponse = await fetch('http://localhost:3000/api/transferencia-produtos/filiais');
    if (!filiaisResponse.ok) {
      throw new Error('Erro ao buscar filiais');
    }
    const filiaisData = await filiaisResponse.json();
    const filiais: Array<{ codFilial: string; filial: string }> = filiaisData.data || [];

    // Encontrar filiais por nome
    const filialOrigem = filiais.find(f => 
      f.filial.toUpperCase().includes('SCARF ME - MATRIZ') ||
      f.filial.toUpperCase().includes('SCARF ME MATRIZ')
    );
    
    const filialDestino = filiais.find(f => 
      f.filial.toUpperCase().includes('SCARF ME - PAULISTA RSR') ||
      f.filial.toUpperCase().includes('SCARF ME PAULISTA RSR') ||
      f.filial.toUpperCase().includes('PAULISTA RSR')
    );

    if (!filialOrigem) {
      console.error('Filial origem "SCARF ME - MATRIZ" não encontrada');
      console.log('Filiais disponíveis:');
      filiais.forEach(f => console.log(`  - ${f.filial} (${f.codFilial})`));
      return;
    }

    if (!filialDestino) {
      console.error('Filial destino "SCARF ME - PAULISTA RSR" não encontrada');
      console.log('Filiais disponíveis:');
      filiais.forEach(f => console.log(`  - ${f.filial} (${f.codFilial})`));
      return;
    }

    console.log(`Filial origem encontrada: ${filialOrigem.filial} (${filialOrigem.codFilial})`);
    console.log(`Filial destino encontrada: ${filialDestino.filial} (${filialDestino.codFilial})`);

    // Configurar permissões
    await savePermissao({
      username: 'logistica',
      filiaisOrigem: [filialOrigem.codFilial],
      filiaisDestino: [filialDestino.codFilial],
      responsavelPadrao: 'LOGISTICA',
      tipoRomaneioPadrao: 'TRANSFERENCIA ENTRE LOJAS',
      responsavelFixo: true,
      tipoRomaneioFixo: true,
    });

    console.log('✅ Permissões configuradas com sucesso!');
    console.log(`
Configuração aplicada:
- Usuário: logistica
- Filial origem permitida: ${filialOrigem.filial} (${filialOrigem.codFilial})
- Filial destino permitida: ${filialDestino.filial} (${filialDestino.codFilial})
- Responsável padrão: LOGISTICA (fixo)
- Tipo de romaneio padrão: TRANSFERENCIA ENTRE LOJAS (fixo)
    `);
  } catch (error) {
    console.error('Erro ao configurar permissões:', error);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  setupLogisticaPermissoes()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { setupLogisticaPermissoes };
