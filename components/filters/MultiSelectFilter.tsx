"use client";

import { useState, useMemo, useRef, useEffect } from "react";

import styles from "./MultiSelectFilter.module.css";

interface MultiSelectFilterProps {
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
}

export default function MultiSelectFilter({
  label,
  value,
  options,
  onChange,
}: MultiSelectFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filtrar opções baseado no termo de pesquisa
  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) {
      return options;
    }
    const term = searchTerm.toLowerCase();
    return options.filter((option) =>
      option.toLowerCase().includes(term)
    );
  }, [options, searchTerm]);

  // Separar opções filtradas em selecionadas e não selecionadas
  const { selectedFiltered, unselectedFiltered } = useMemo(() => {
    const selected: string[] = [];
    const unselected: string[] = [];
    
    filteredOptions.forEach((option) => {
      if (value.includes(option)) {
        selected.push(option);
      } else {
        unselected.push(option);
      }
    });
    
    return {
      selectedFiltered: selected,
      unselectedFiltered: unselected,
    };
  }, [filteredOptions, value]);


  // Verificar se todos os itens filtrados estão selecionados
  const allFilteredSelected = useMemo(() => {
    if (filteredOptions.length === 0) return false;
    return filteredOptions.every((option) => value.includes(option));
  }, [filteredOptions, value]);

  // Verificar se algum item filtrado está selecionado
  const someFilteredSelected = useMemo(() => {
    return filteredOptions.some((option) => value.includes(option));
  }, [filteredOptions, value]);

  // Focar no campo de pesquisa quando abrir
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchTerm("");
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen]);

  const handleToggleAll = () => {
    if (allFilteredSelected) {
      // Remover todos os itens filtrados
      const newValue = value.filter((item) => !filteredOptions.includes(item));
      onChange(newValue);
    } else {
      // Adicionar todos os itens filtrados
      const newValue = [...new Set([...value, ...filteredOptions])];
      onChange(newValue);
    }
  };

  const handleToggleOption = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter((item) => item !== option));
    } else {
      onChange([...value, option]);
    }
  };

  const handleClearAll = () => {
    onChange([]);
  };

  const displayValue =
    value.length === 0
      ? "Todos"
      : value.length === 1
      ? value[0]
      : `${value.length} selecionados`;

  return (
    <div className={styles.container} ref={dropdownRef}>
      <span className={styles.label}>{label}</span>
      <button
        type="button"
        className={`${styles.button} ${isOpen ? styles.buttonActive : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className={styles.buttonValue}>
          <span className={styles.valuePrimary}>{displayValue}</span>
        </span>
        <span>▼</span>
      </button>

      {isOpen ? (
        <div className={styles.dropdown}>
          <div className={styles.searchContainer}>
            <div className={styles.searchInputWrapper}>
              <input
                ref={searchInputRef}
                type="text"
                className={styles.searchInput}
                placeholder="Pesquisar"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              {searchTerm && (
                <button
                  type="button"
                  className={styles.clearButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchTerm("");
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Limpar pesquisa"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div className={styles.optionsContainer}>
            <div className={styles.listHeader}>
              <button
                type="button"
                className={`${styles.option} ${styles.selectAllOption} ${
                  allFilteredSelected ? styles.optionActive : ""
                }`}
                onClick={handleToggleAll}
              >
                <span className={styles.checkbox}>
                  {allFilteredSelected ? "✓" : someFilteredSelected ? "⊞" : ""}
                </span>
                <span>(Selecionar Tudo)</span>
              </button>
              {value.length > 0 && (
                <button
                  type="button"
                  className={styles.clearAllButton}
                  onClick={handleClearAll}
                  title="Limpar todas as seleções"
                >
                  Limpar tudo
                </button>
              )}
            </div>

            {filteredOptions.length === 0 ? (
              <div className={styles.noResults}>Nenhum resultado encontrado</div>
            ) : (
              <>
                {/* Mostrar itens selecionados primeiro */}
                {selectedFiltered.length > 0 && (
                  <>
                    {selectedFiltered.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`${styles.option} ${styles.optionActive} ${styles.optionSelected}`}
                        onClick={() => handleToggleOption(option)}
                      >
                        <span className={styles.checkbox}>✓</span>
                        <span>{option}</span>
                      </button>
                    ))}
                    {unselectedFiltered.length > 0 && (
                      <div className={styles.separator}></div>
                    )}
                  </>
                )}
                
                {/* Mostrar itens não selecionados */}
                {unselectedFiltered.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={styles.option}
                    onClick={() => handleToggleOption(option)}
                  >
                    <span className={styles.checkbox}></span>
                    <span>{option}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

