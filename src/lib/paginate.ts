export function paginate<T>(items: readonly T[], page: number, pageSize = 100): {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
} {
  const total = items.length;
  const size = Math.max(1, Math.floor(pageSize) || 100);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.min(pageCount, Math.max(1, Math.floor(page) || 1));
  return { items: items.slice((currentPage - 1) * size, currentPage * size), page: currentPage, pageCount, total };
}
