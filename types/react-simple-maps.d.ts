declare module 'react-simple-maps' {
  import * as React from 'react';

  export interface ComposableMapProps {
    projection?: string;
    projectionConfig?: Record<string, unknown>;
    viewBox?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
    [key: string]: unknown;
  }
  export const ComposableMap: React.FC<ComposableMapProps>;

  export interface GeographiesProps {
    geography: string | object;
    children: (args: { geographies: unknown[] }) => React.ReactNode;
    [key: string]: unknown;
  }
  export const Geographies: React.FC<GeographiesProps>;

  export interface GeographyProps {
    geography: unknown;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    style?: {
      default?: React.CSSProperties;
      hover?: React.CSSProperties;
      pressed?: React.CSSProperties;
    };
    onMouseEnter?: (event: unknown) => void;
    onMouseMove?: (event: unknown) => void;
    onMouseLeave?: () => void;
    key?: string;
    [key: string]: unknown;
  }
  export const Geography: React.FC<GeographyProps>;
}
