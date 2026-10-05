import { createSortStore, nextSort, type SortChoice } from '../../ui/sortChoice'
import { CATALOG_SORTS, isCatalogDateSort, type CatalogSort } from './catalogSort'

export const CATALOG_SORT_KEY = 'crosstune.catalogSort.v1'

export const { useSort: useCatalogSort, setSort: setCatalogSort } = createSortStore(
  CATALOG_SORT_KEY,
  CATALOG_SORTS,
  { sort: 'title', descending: false },
)

export function pickCatalogSort(
  current: SortChoice<CatalogSort>,
  picked: CatalogSort,
): SortChoice<CatalogSort> {
  return nextSort(current, picked, isCatalogDateSort)
}
