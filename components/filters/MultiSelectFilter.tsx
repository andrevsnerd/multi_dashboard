"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./MultiSelectFilter.module.css";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  label: string;
  value: string[];
  options: Array<string | MultiSelectOption>;
  onChange: (value: string[]) => void;
  onOpen?: () => void;
  loading?: boolean;
}

function normalizeOption(option: string | MultiSelectOption): MultiSelectOption {
  if (typeof option === "string") {
    return { value: option, label: option };
  }

  return option;
}

export default function MultiSelectFilter({
  label,
  value,
  options,
  onChange,
  onOpen,
  loading = false,
}: MultiSelectFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const normalizedOptions = useMemo(() => options.map(normalizeOption), [options]);
  const labelByValue = useMemo(
    () => new Map(normalizedOptions.map((option) => [option.value, option.label] as const)),
    [normalizedOptions]
  );

  const handleToggleOpen = () => {
    if (!isOpen) {
      onOpen?.();
    }
    setIsOpen((prev) => !prev);
  };

  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) {
      return normalizedOptions;
    }

    const term = searchTerm.toLowerCase();
    return normalizedOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(term) || option.value.toLowerCase().includes(term)
    );
  }, [normalizedOptions, searchTerm]);

  const { selectedFiltered, unselectedFiltered } = useMemo(() => {
    const selected: MultiSelectOption[] = [];
    const unselected: MultiSelectOption[] = [];

    filteredOptions.forEach((option) => {
      if (value.includes(option.value)) {
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

  const allFilteredSelected = useMemo(() => {
    if (filteredOptions.length === 0) return false;
    return filteredOptions.every((option) => value.includes(option.value));
  }, [filteredOptions, value]);

  const someFilteredSelected = useMemo(() => {
    return filteredOptions.some((option) => value.includes(option.value));
  }, [filteredOptions, value]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
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
      const filteredValues = new Set(filteredOptions.map((option) => option.value));
      onChange(value.filter((item) => !filteredValues.has(item)));
      return;
    }

    onChange([...new Set([...value, ...filteredOptions.map((option) => option.value)])]);
  };

  const handleToggleOption = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((item) => item !== optionValue));
      return;
    }

    onChange([...value, optionValue]);
  };

  const displayValue =
    value.length === 0
      ? "Todos"
      : value.length === 1
      ? (labelByValue.get(value[0]) ?? value[0])
      : `${value.length} selecionados`;

  return (
    <div className={styles.container} ref={dropdownRef}>
      <span className={styles.label}>{label}</span>
      <button
        type="button"
        className={`${styles.button} ${isOpen ? styles.buttonActive : ""}`}
        onClick={handleToggleOpen}
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
                  onClick={() => onChange([])}
                  title="Limpar todas as seleções"
                >
                  Limpar tudo
                </button>
              )}
            </div>

            {loading ? (
              <div className={styles.noResults}>Carregando...</div>
            ) : filteredOptions.length === 0 ? (
              <div className={styles.noResults}>Nenhum resultado encontrado</div>
            ) : (
              <>
                {selectedFiltered.length > 0 && (
                  <>
                    {selectedFiltered.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`${styles.option} ${styles.optionActive} ${styles.optionSelected}`}
                        onClick={() => handleToggleOption(option.value)}
                      >
                        <span className={styles.checkbox}>✓</span>
                        <span>{option.label}</span>
                      </button>
                    ))}
                    {unselectedFiltered.length > 0 && <div className={styles.separator}></div>}
                  </>
                )}

                {unselectedFiltered.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={styles.option}
                    onClick={() => handleToggleOption(option.value)}
                  >
                    <span className={styles.checkbox}></span>
                    <span>{option.label}</span>
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
