-- ==========================================================
-- Roti Boss Gudang — Seed Data
-- Jalankan SETELAH db:schema
-- ==========================================================

-- Hapus data lama dulu biar bisa dijalankan berulang (opsional)
DELETE FROM users;

-- ==========================================================
-- USERS
-- PIN default diganti dari 123456 → 258014
-- Ganti PIN sesuai kebutuhan sebelum production!
-- ==========================================================
INSERT INTO users (email, nama, role, pin) VALUES
  ('bambang@rotiboss.local', 'Bambang', 'admin', '258014'),
  ('siti@rotiboss.local', 'Siti', 'petugas', '111222'),
  ('andi@rotiboss.local', 'Andi', 'petugas', '333444'),
  ('rina@rotiboss.local', 'Rina', 'petugas', '555666');

-- ==========================================================
-- Catatan:
-- - email hanya dipakai sebagai primary key, login pakai nama + pin
-- - role: 'admin' | 'petugas'
-- - PIN disimpan plain (sesuai desain saat ini). Nanti bisa di-hash kalau mau.
-- ==========================================================