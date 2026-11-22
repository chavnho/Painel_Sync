import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface SymbolAutocompleteProps {
  symbols: string[];
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
  placeholder?: string;
}

export function SymbolAutocomplete({ symbols, selectedSymbol, onSelect, placeholder = "Selecione um ativo..." }: SymbolAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(selectedSymbol);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredSymbols = symbols.filter(s => 
    s.toUpperCase().includes(searchTerm.toUpperCase())
  );

  const handleSelect = (symbol: string) => {
    onSelect(symbol);
    setIsOpen(false);
    setSearchTerm(symbol);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-2 bg-[#11161D] border border-[#263040] rounded-lg px-3 py-1.5">
        <span className="text-xs text-gray-400">Ativo:</span>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="bg-transparent border-none focus:outline-none text-sm font-bold text-gray-100 w-32"
        />
        <ChevronDown 
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          onClick={() => setIsOpen(!isOpen)}
        />
      </div>

      {isOpen && filteredSymbols.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-[#11161D] border border-[#263040] rounded-lg shadow-xl">
          {filteredSymbols.map((symbol) => (
            <div
              key={symbol}
              onClick={() => handleSelect(symbol)}
              className="px-3 py-2 text-xs text-gray-200 hover:bg-[#1E2633] cursor-pointer flex items-center justify-between"
            >
              <span>{symbol}</span>
              {selectedSymbol === symbol && <Check className="w-3.5 h-3.5 text-emerald-400" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
