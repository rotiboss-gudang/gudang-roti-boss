-- Additional indexes for common authentication and Opname queries.
-- Safe to run repeatedly because each index is created only if missing.
CREATE INDEX IF NOT EXISTS idx_users_nama ON users(nama);
CREATE INDEX IF NOT EXISTS idx_transaksi_tipe_timestamp ON transaksi(tipe, timestamp DESC);
PRAGMA optimize;
