export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageDimensions {
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
}

export interface CaptureSegment {
  dataUrl: string;
  offsetY: number;
}

export type CaptureMode = "visible" | "area" | "full";
