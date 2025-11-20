#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script principal que executa todos os testes e gera um relatório consolidado
"""

import subprocess
import sys
import os
from datetime import datetime

def run_script(script_name, description):
    """Executa um script Python e captura a saída"""
    print("\n" + "="*80)
    print(f"EXECUTANDO: {description}")
    print("="*80)
    print(f"Script: {script_name}")
    print("-"*80)
    
    try:
        result = subprocess.run(
            [sys.executable, script_name],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace'
        )
        
        print(result.stdout)
        
        if result.stderr:
            print("\n[ERROS/AVISOS]:")
            print(result.stderr)
        
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        print(f"✗ Erro ao executar {script_name}: {e}")
        return False, "", str(e)

def main():
    """Executa todos os testes"""
    print("="*80)
    print("SUITE DE TESTES: Investigação E-commerce")
    print("="*80)
    print(f"Iniciado em: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    scripts = [
        ('test_ecommerce_investigation.py', 'Investigação Principal'),
        ('test_deep_analysis.py', 'Análise Profunda'),
        ('test_compare_with_csv.py', 'Comparação com CSV'),
    ]
    
    results = {}
    
    for script, description in scripts:
        if os.path.exists(script):
            success, stdout, stderr = run_script(script, description)
            results[script] = {
                'success': success,
                'stdout': stdout,
                'stderr': stderr
            }
        else:
            print(f"\n⚠ Script não encontrado: {script}")
            results[script] = {
                'success': False,
                'stdout': '',
                'stderr': f'Script não encontrado: {script}'
            }
    
    # Resumo final
    print("\n" + "="*80)
    print("RESUMO FINAL")
    print("="*80)
    
    for script, result in results.items():
        status = "✓ SUCESSO" if result['success'] else "✗ FALHOU"
        print(f"{status}: {script}")
    
    print("\n" + "="*80)
    print("PRÓXIMOS PASSOS")
    print("="*80)
    print("1. Revise os resultados acima")
    print("2. Identifique a causa da diferença")
    print("3. Corrija o código TypeScript conforme necessário")
    print("4. Execute os testes novamente para validar a correção")
    print("="*80)
    print(f"Concluído em: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == '__main__':
    main()

