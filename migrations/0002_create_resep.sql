-- Create recipe/BOM storage for existing D1 databases that were initialized without it.
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
