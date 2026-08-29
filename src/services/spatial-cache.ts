/**
 * Groups every cached read that a write to (entityType, tenantId) invalidates.
 * NUL separates the parts so no combination of legal values can collide.
 */
export function cacheTag(entityType: string, tenantId: number): string {
  return `${entityType}\x00${tenantId}`;
}
