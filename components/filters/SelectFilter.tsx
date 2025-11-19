"use client";

import { useState } from "react";

import styles from "./SelectFilter.module.css";

interface SelectFilterProps {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
}

export default function SelectFilter({
  label,
  value,
  options,
  onChange,
}: SelectFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const displayValue = value || "Todos";

  return (
    <div className={styles.container}>
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
        <>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div className={styles.dropdown}>
            <button
              type="button"
              className={`${styles.option} ${value === null ? styles.optionActive : ""}`}
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
            >
              Todos
            </button>
            {options.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.option} ${value === option ? styles.optionActive : ""}`}
                onClick={() => {
                  onChange(option);
                  setIsOpen(false);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}



