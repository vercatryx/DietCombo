-- Migration: driver_route_order table for stable routes (one ordered list of clients per driver).
-- Route order is stored here; day-to-day we skip clients with no stop on that date.
-- See docs/PROPOSAL_STABLE_ROUTES_SCHEMA.md and docs/PROPOSAL_STABLE_ROUTES_STRESS_TEST.md

-- Create driver_route_order table
CREATE TABLE IF NOT EXISTS driver_route_order (
    driver_id VARCHAR(36) NOT NULL,
    client_id VARCHAR(36) NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (driver_id, client_id),
    CONSTRAINT fk_driver_route_order_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
    CONSTRAINT fk_driver_route_order_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_driver_route_order_driver_position ON driver_route_order(driver_id, position);
CREATE INDEX IF NOT EXISTS idx_driver_route_order_client ON driver_route_order(client_id);

COMMENT ON TABLE driver_route_order IS 'Ordered list of clients per driver (stable route). Same list every day; clients with no stop on a date are skipped when building that day''s route.';
