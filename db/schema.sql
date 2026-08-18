-- ==========================================================
-- Roti Boss Gudang — D1 Database V2
-- Initial schema
-- Data starts empty; only structure is created here.
-- ==========================================================

PRAGMA foreign_keys = ON;

-- ==========================================================
-- MASTER BAHAN
-- ==========================================================
CREATE TABLE IF NOT EXISTS bahan (
  sku TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  kategori TEXT NOT NULL DEFAULT '',
  stok REAL NOT NULL DEFAULT 0,
  satuan TEXT NOT NULL DEFAULT '',
  min_stok REAL NOT NULL DEFAULT 0,
  expired TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bahan_nama ON bahan(nama);
CREATE INDEX IF NOT EXISTS idx_bahan_kategori ON bahan(kategori);
CREATE INDEX IF NOT EXISTS idx_bahan_expired ON bahan(expired);

-- ==========================================================
-- RESEP / BOM
-- Satu produk dapat memiliki banyak bahan.
-- ==========================================================
CREATE TABLE IF NOT EXISTS resep (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produk TEXT NOT NULL,
  sku TEXT NOT NULL,
  qty_per_batch REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(produk, sku),
  FOREIGN KEY (sku) REFERENCES bahan(sku) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_resep_produk ON resep(produk);
CREATE INDEX IF NOT EXISTS idx_resep_sku ON resep(sku);

-- ==========================================================
-- TRANSAKSI
-- Log transaksi bersifat append-only secara aplikasi.
-- ==========================================================
CREATE TABLE IF NOT EXISTS transaksi (
  id_transaksi TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  tipe TEXT NOT NULL CHECK (tipe IN ('Masuk', 'Keluar', 'Rusak-Expired', 'Opname')),
  sku TEXT NOT NULL,
  nama_bahan TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  satuan TEXT NOT NULL DEFAULT '',
  stok_awal REAL NOT NULL DEFAULT 0,
  stok_akhir REAL NOT NULL DEFAULT 0,
  keterangan TEXT NOT NULL DEFAULT '',
  petugas TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sku) REFERENCES bahan(sku) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_transaksi_timestamp ON transaksi(timestamp);
CREATE INDEX IF NOT EXISTS idx_transaksi_tipe ON transaksi(tipe);
CREATE INDEX IF NOT EXISTS idx_transaksi_sku ON transaksi(sku);
CREATE INDEX IF NOT EXISTS idx_transaksi_timestamp_tipe ON transaksi(timestamp, tipe);

-- ==========================================================
-- USERS
-- ==========================================================
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'petugas',
  pin TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
