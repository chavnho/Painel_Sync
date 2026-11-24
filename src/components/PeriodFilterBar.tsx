import { useMemo, useState } from 'react';
import type { RobotStream } from '../types/trading';
import { getMergedRobotHistory } from '../utils/tradingMath';

export interface PeriodFilterState {
  selectedYear: string;
  selectedMonth: string;
  startDate: string;
  endDate: string;
  availableYears: string[];
  setStartDate: (val: string) => void;
  setEndDate: (val: string) => void;
  setSelectedMonth: (val: string) => void;
  handleSelectMonthPreset: (yearStr: string, monthStr: string) => void;
  clearDates: () => void;
  matchesDate: (exitDate?: string) => boolean;
  periodSummaryLabel: string;
}

export function usePeriodFilter(robots: RobotStream[]): PeriodFilterState {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>(String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');

  const availableYears = useMemo(() => {
    const years = new Set<string>([String(new Date().getFullYear())]);
    for (const r of robots) {
      for (const tr of getMergedRobotHistory(r)) {
        const y = (tr.exitDate || '').slice(0, 4);
        if (/^\d{4}$/.test(y)) years.add(y);
      }
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [robots]);

  const handleSelectMonthPreset = (yearStr: string, monthStr: string) => {
    setSelectedYear(yearStr);
    setSelectedMonth(monthStr);
    if (monthStr === 'ALL') {
      setStartDate('');
      setEndDate('');
      return;
    }
    const y = Number(yearStr);
    const m = Number(monthStr);
    const lastDay = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, '0');
    const dd = String(lastDay).padStart(2, '0');
    setStartDate(`${y}-${mm}-01`);
    setEndDate(`${y}-${mm}-${dd}`);
  };

  const clearDates = () => {
    setStartDate('');
    setEndDate('');
    setSelectedMonth('ALL');
  };

  const matchesDate = (exitDate?: string): boolean => {
    const normDate = (exitDate || '').replace(/\./g, '-').slice(0, 10);
    if (startDate && normDate && normDate < startDate) return false;
    if (endDate && normDate && normDate > endDate) return false;
    return true;
  };

  const periodSummaryLabel = useMemo(() => {
    if (!startDate && !endDate) return 'Todo o histórico';
    if (startDate && endDate) return `${startDate.split('-').reverse().join('/')} até ${endDate.split('-').reverse().join('/')}`;
    if (startDate) return `A partir de ${startDate.split('-').reverse().join('/')}`;
    return `Até ${endDate.split('-').reverse().join('/')}`;
  }, [startDate, endDate]);

  return {
    selectedYear,
    selectedMonth,
    startDate,
    endDate,
    availableYears,
    setStartDate,
    setEndDate,
    setSelectedMonth,
    handleSelectMonthPreset,
    clearDates,
    matchesDate,
    periodSummaryLabel,
  };
}

interface PeriodFilterBarProps {
  filter: PeriodFilterState;
  onManualDateChange?: () => void;
}

export function PeriodFilterBar({ filter, onManualDateChange }: PeriodFilterBarProps) {
  const {
    selectedYear,
    selectedMonth,
    startDate,
    endDate,
    availableYears,
    setStartDate,
    setEndDate,
    setSelectedMonth,
    handleSelectMonthPreset,
    clearDates,
  } = filter;

  return (
    <>
      <div className="flex items-center gap-1 bg-[#0D1117] p-0.5 rounded-lg border border-[#1E2633]">
        <select
          value={selectedYear}
          onChange={(e) => {
            handleSelectMonthPreset(e.target.value, selectedMonth);
            onManualDateChange?.();
          }}
          title="Selecionar Ano"
          className="bg-transparent text-gray-200 text-[11px] font-semibold px-2 py-1 focus:outline-none cursor-pointer"
        >
          {availableYears.map((yr) => (
            <option key={yr} value={yr} className="bg-[#0D1117] text-gray-200">
              {yr}
            </option>
          ))}
        </select>
        <span className="text-gray-700 text-xs">|</span>
        <select
          value={selectedMonth}
          onChange={(e) => {
            handleSelectMonthPreset(selectedYear, e.target.value);
            onManualDateChange?.();
          }}
          title="Filtrar por Mês"
          className="bg-transparent text-gray-200 text-[11px] font-medium px-2 py-1 focus:outline-none cursor-pointer"
        >
          <option value="ALL" className="bg-[#0D1117] text-gray-200">Todos os meses</option>
          <option value="01" className="bg-[#0D1117] text-gray-200">Janeiro</option>
          <option value="02" className="bg-[#0D1117] text-gray-200">Fevereiro</option>
          <option value="03" className="bg-[#0D1117] text-gray-200">Março</option>
          <option value="04" className="bg-[#0D1117] text-gray-200">Abril</option>
          <option value="05" className="bg-[#0D1117] text-gray-200">Maio</option>
          <option value="06" className="bg-[#0D1117] text-gray-200">Junho</option>
          <option value="07" className="bg-[#0D1117] text-gray-200">Julho</option>
          <option value="08" className="bg-[#0D1117] text-gray-200">Agosto</option>
          <option value="09" className="bg-[#0D1117] text-gray-200">Setembro</option>
          <option value="10" className="bg-[#0D1117] text-gray-200">Outubro</option>
          <option value="11" className="bg-[#0D1117] text-gray-200">Novembro</option>
          <option value="12" className="bg-[#0D1117] text-gray-200">Dezembro</option>
        </select>
      </div>

      <div className="flex items-center gap-1.5 bg-[#0D1117] px-2.5 py-1 rounded-lg border border-[#1E2633] text-[11px] text-gray-400">
        <span>De</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            setSelectedMonth('ALL');
            onManualDateChange?.();
          }}
          className="bg-transparent text-gray-200 focus:outline-none [color-scheme:dark] text-[11px] cursor-pointer"
        />
        <span className="text-gray-600">até</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => {
            setEndDate(e.target.value);
            setSelectedMonth('ALL');
            onManualDateChange?.();
          }}
          className="bg-transparent text-gray-200 focus:outline-none [color-scheme:dark] text-[11px] cursor-pointer"
        />
        {(startDate || endDate) && (
          <button
            type="button"
            onClick={() => {
              clearDates();
              onManualDateChange?.();
            }}
            className="ml-1 text-[10px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
          >
            Limpar
          </button>
        )}
      </div>
    </>
  );
}