-- Menyimpan PIN baru secara salted PBKDF2 hash.
-- Kolom pin lama dipertahankan sementara untuk migrasi login bertahap.
ALTER TABLE users ADD COLUMN pin_hash TEXT;
ALTER TABLE users ADD COLUMN pin_salt TEXT;
ALTER TABLE users ADD COLUMN pin_iterations INTEGER NOT NULL DEFAULT 120000;
