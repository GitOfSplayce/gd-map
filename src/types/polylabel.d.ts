declare module 'polylabel' {
  /** Point intérieur le plus éloigné des bords ; `distance` = rayon du plus grand cercle inscrit. */
  export default function polylabel(polygon: number[][][], precision?: number): [number, number] & { distance: number }
}
