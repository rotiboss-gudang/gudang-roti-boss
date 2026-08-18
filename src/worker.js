// ==========================================================
// Roti Boss Gudang - D1 API V2
// Tahap 1: health check + CRUD Bahan
// ==========================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return json({ success: true }, 200, cors());
      }

      if (url.pathname === "/api/health" && request.method === "GET") {
        const result = await env.DB.prepare("SELECT 1 AS ok").first();
        return json({
          success: true,
          message: "D1 connected",
          database: result?.ok === 1
        });
      }

      if (url.pathname === "/api/bahan" && request.method === "GET") {
        return getBahan(env);
      }

      if (url.pathname === "/api/bahan" && request.method === "POST") {
        return saveBahan(request, env);
      }

      if (url.pathname === "/api/bahan" && request.method === "DELETE") {
        return deleteBahan(request, env);
      }

      return json({
        success: false,
        message: "Endpoint tidak ditemukan"
      }, 404);

    } catch (error) {
      console.error(error);
      return json({
        success: false,
        message: error?.message || "Server error"
      }, 500);
    }
  }
};

// ==========================================================
// GET /api/bahan
// ==========================================================
async function getBahan(env) {
  const { results } = await env.DB.prepare(`
    SELECT
      sku,
      nama,
      kategori,
      stok,
      satuan,
      min_stok AS minStok,
      expired
    FROM bahan
    ORDER BY nama COLLATE NOCASE ASC
  `).all();

  return json({
    success: true,
    data: results || []
  });
}

// ==========================================================
// POST /api/bahan
// ==========================================================
// Mode:
// - create: insert bahan baru
// - update: update bahan berdasarkan SKU
// ==========================================================
async function saveBahan(request, env) {
  const data = await request.json();
  const mode = data?.mode || "create";

  const sku = String(data?.sku || "").trim();
  const nama = String(data?.nama || "").trim();
  const kategori = String(data?.kategori || "").trim();
  const satuan = String(data?.satuan || "").trim();
  const stok = Number(data?.stok ?? 0);
  const minStok = Number(data?.minStok ?? 0);
  const expired = data?.expired ? String(data.expired) : null;

  if (!sku || !nama || !satuan) {
    return json({
      success: false,
      message: "SKU, nama bahan, dan satuan wajib diisi"
    }, 400);
  }

  if (!Number.isFinite(stok) || !Number.isFinite(minStok)) {
    return json({
      success: false,
      message: "Stok atau minimum stok tidak valid"
    }, 400);
  }

  if (mode === "update") {
    const result = await env.DB.prepare(`
      UPDATE bahan
      SET
        nama = ?,
        kategori = ?,
        stok = ?,
        satuan = ?,
        min_stok = ?,
        expired = ?
      WHERE sku = ?
    `).bind(
      nama,
      kategori,
      stok,
      satuan,
      minStok,
      expired,
      sku
    ).run();

    if (!result.meta?.changes) {
      return json({
        success: false,
        message: "SKU tidak ditemukan"
      }, 404);
    }

    return json({
      success: true,
      message: "Bahan berhasil diupdate"
    });
  }

  try {
    await env.DB.prepare(`
      INSERT INTO bahan
        (sku, nama, kategori, stok, satuan, min_stok, expired)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sku,
      nama,
      kategori,
      stok,
      satuan,
      minStok,
      expired
    ).run();

    return json({
      success: true,
      message: "Bahan berhasil ditambahkan"
    }, 201);

  } catch (error) {
    if (String(error?.message || "").toLowerCase().includes("unique")) {
      return json({
        success: false,
        message: "SKU sudah digunakan"
      }, 409);
    }
    throw error;
  }
}

// ==========================================================
// DELETE /api/bahan
// Body: { sku: "..." }
// ==========================================================
async function deleteBahan(request, env) {
  const data = await request.json();
  const sku = String(data?.sku || "").trim();

  if (!sku) {
    return json({
      success: false,
      message: "SKU wajib diisi"
    }, 400);
  }

  try {
    const result = await env.DB.prepare(
      "DELETE FROM bahan WHERE sku = ?"
    ).bind(sku).run();

    if (!result.meta?.changes) {
      return json({
        success: false,
        message: "SKU tidak ditemukan"
      }, 404);
    }

    return json({
      success: true,
      message: "Bahan berhasil dihapus"
    });

  } catch (error) {
    if (String(error?.message || "").toLowerCase().includes("foreign key")) {
      return json({
        success: false,
        message: "Bahan tidak bisa dihapus karena masih digunakan di resep"
      }, 409);
    }
    throw error;
  }
}

// ==========================================================
// JSON RESPONSE
// ==========================================================
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cors(),
      ...extraHeaders
    }
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
