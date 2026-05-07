/**
 * `orders` rows track freshness via `last_updated` (Prisma: Order.lastUpdated).
 * Merge this into every `.from('orders').update(...)` payload.
 *
 * Note: If Postgres still has `update_updated_at_column()` assigning NEW.updated_at,
 * updates will fail with "record \"new\" has no field \"updated_at\"" until that
 * trigger function is corrected for `orders` / `upcoming_orders` (they use
 * last_updated, not updated_at). Setting last_updated from app code does not
 * replace fixing that trigger—it runs on the server regardless of this payload.
 */
export function ordersRowTouch(): { last_updated: string } {
    return { last_updated: new Date().toISOString() };
}
