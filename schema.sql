-- ==========================================================
-- Roti Boss Gudang - Cloudflare D1 Schema V2
-- Database: roti-boss-gudang
-- Posisi awal: kosong, hanya struktur tabel.
-- ==========================================================

PRAGMA foreign_keys = ON;

-- ==========================================================
-- 1. BAHAN
-- ==========================================================
CREATE TABLE IF NOT EXISTS bahan (
  sku TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  kategori TEXT NOT NULL DEFAULT '',
  stok REAL NOT NULL DEFAULT 0,
  satuan TEXT NOT NULL DEFAULT '',
  min_stok REAL NOT NULL DEFAULT 0,
  expired TEXT
);

CREATE INDEX IF NOT EXISTS idx_bahan_nama ON bahan(nama);
CREATE INDEX IF NOT EXISTS idx_bahan_kategori ON bahan(kategori);
CREATE INDEX IF NOT EXISTS idx_bahan_expired ON bahan(expired);

-- ==========================================================
-- 2. RESEP
-- ==========================================================
CREATE TABLE IF NOT EXISTS resep (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produk TEXT NOT NULL,
  sku TEXT NOT NULL,
  qty_per_batch REAL NOT NULL DEFAULT 0,
  UNIQUE(produk, sku),
  FOREIGN KEY (sku) REFERENCES bahan(sku) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_resep_produk ON resep(produk);
CREATE INDEX IF NOT EXISTS idx_resep_sku ON resep(sku);

-- ==========================================================
-- 3. TRANSAKSI
-- ==========================================================
CREATE TABLE IF NOT EXISTS transaksi (
  id_transaksi TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  tipe TEXT NOT NULL,
  sku TEXT NOT NULL,
  nama_bahan TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  satuan TEXT NOT NULL DEFAULT '',
  stok_awal REAL,
  stok_akhir REAL,
  keterangan TEXT NOT NULL DEFAULT '',
  petugas TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_transaksi_timestamp ON transaksi(timestamp);
CREATE INDEX IF NOT EXISTS idx_transaksi_tipe ON transaksi(tipe);
CREATE INDEX IF NOT EXISTS idx_transaksi_sku ON transaksi(sku);
CREATE INDEX IF NOT EXISTS idx_transaksi_timestamp_tipe ON transaksi(timestamp, tipe);
CREATE INDEX IF NOT EXISTS idx_transaksi_keterangan ON transaksi(keterangan);

-- ==========================================================
-- 4. USERS
-- ==========================================================
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'petugas',
  pin TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ==========================================================
-- Catatan desain
--
-- Tidak ada tabel upload/file.
-- PDF laporan tetap disimpan di Google Drive / storage laporan,
-- bukan di database.
-- ==========================================================
