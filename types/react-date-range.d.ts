declare module 'react-date-range' {
  export interface DateRange {
    startDate: Date;
    endDate: Date;
    key?: string;
  }

  export interface RangeKeyDict {
    selection: DateRange;
  }

  export interface CalendarProps {
    date?: Date;
    onChange?: (date: Date) => void;
    minDate?: Date;
    maxDate?: Date;
    months?: number;
    direction?: 'vertical' | 'horizontal';
    scroll?: {
      enabled?: boolean;
      calendarHeight?: number;
    };
    rangeColors?: string[];
    showDateDisplay?: boolean;
    showMonthAndYearPickers?: boolean;
    showPreview?: boolean;
    preview?: {
      startDate?: Date;
      endDate?: Date;
      color?: string;
    };
    onShownDateChange?: (date: Date) => void;
    disabledDates?: Date[];
    disabledDay?: (date: Date) => boolean;
    maxDate?: Date;
    minDate?: Date;
    locale?: any;
  }

  export interface DateRangePickerProps {
    ranges?: DateRange[];
    onChange?: (item: RangeKeyDict) => void;
    showSelectionPreview?: boolean;
    moveRangeOnFirstSelection?: boolean;
    months?: number;
    direction?: 'vertical' | 'horizontal';
    scroll?: {
      enabled?: boolean;
      calendarHeight?: number;
    };
    rangeColors?: string[];
    showDateDisplay?: boolean;
    showMonthAndYearPickers?: boolean;
    showPreview?: boolean;
    showMonthArrow?: boolean;
    preview?: {
      startDate?: Date;
      endDate?: Date;
      color?: string;
    };
    onShownDateChange?: (date: Date) => void;
    disabledDates?: Date[];
    disabledDay?: (date: Date) => boolean;
    maxDate?: Date;
    minDate?: Date;
    locale?: any;
    editableDateInputs?: boolean;
    dateDisplayFormat?: string;
    monthDisplayFormat?: string;
    weekdayDisplayFormat?: string;
    dayDisplayFormat?: string;
    [key: string]: any; // Permitir outras propriedades que não foram definidas
  }

  export const DateRange: React.FC<DateRangePickerProps>;
  export const Calendar: React.FC<CalendarProps>;

  export default DateRange;
}

