/** Pages à montrer : la première, la dernière, celles autour de la page ouverte ; null pour un saut. */
export function pageList(page: number, pages: number): (number | null)[] {
  const keep = [...new Set([1, 2, page - 1, page, page + 1, pages - 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)
  return keep.flatMap((p, i) => {
    const gap = i ? p - keep[i - 1] : 1
    // Un seul numéro sauté : autant le montrer
    return gap === 2 ? [p - 1, p] : gap > 2 ? [null, p] : [p]
  })
}
