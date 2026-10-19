-- Menyimpan jumlah iterasi PBKDF2 per akun agar hash lama dan baru dapat diverifikasi.
-- Hash lama tetap memakai 120000; hash baru memakai nilai yang ditetapkan Worker.
ALTER TABLE users ADD COLUMN pin_iterations INTEGER NOT NULL DEFAULT 120000;
