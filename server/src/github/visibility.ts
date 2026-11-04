/**
 * Small normalizers shared between the GitHub adapters (T039/T042).
 */
import type { RepositoryVisibility } from '@pr-review-dashboard/shared';

/** GraphQL `Repository.visibility` → wire enum; unknown values read as private. */
export function normalizeRepositoryVisibility(
  value: string | null | undefined,
): RepositoryVisibility {
  if (value === 'INTERNAL') return 'internal';
  if (value === 'PUBLIC') return 'public';
  return 'private';
}
