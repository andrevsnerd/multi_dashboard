"use client";

import { useState, useRef, useEffect } from "react";

import styles from "./EngineButton.module.css";

interface EngineButtonProps {
  onMetasClick: () => void;
}

export default function EngineButton({ onMetasClick }: EngineButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className={styles.container} ref={dropdownRef}>
      <button
        type="button"
        className={styles.button}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Configurações"
      >
        ⚙️
      </button>

      {isOpen && (
        <div className={styles.dropdown}>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              onMetasClick();
              setIsOpen(false);
            }}
          >
            Metas
          </button>
        </div>
      )}
    </div>
  );
}

