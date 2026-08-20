// Roti Boss Gudang - Cloudflare D1 API
// Menyediakan kontrak API baru (/api/*) dan kompatibilitas action lama dari Google Sheets.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return json({ success: true }, 200, cors());

      if (url.pathname === "/api/health" && request.method === "GET") {
        const result = await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ success: true, message: "D1 connected", database: result?.ok === 1 });
      }

      if (url.pathname === "/api/bahan") {
        if (request.method === "GET") return getBahan(env);
        if (request.method === "POST") return saveBahan(request, env);
        if (request.method === "DELETE") return deleteBahan(request, env);
      }
      if (url.pathname === "/api/transaksi") {
        if (request.method === "GET") return getTransaksi(url, env);
        if (request.method === "POST") return saveTransaksi(request, env);
        if (request.method === "DELETE") return cancelTransaksi(request, env);
      }
      if (url.pathname === "/api/resep") {
        if (request.method === "GET") return getResep(env);
        if (request.method === "POST") return saveResep(request, env);
        if (request.method === "DELETE") return deleteResep(request, env);
      }
      if (url.pathname === "/api/produksi" && request.method === "POST") return saveProduksi(request, env);
      if (url.pathname === "/api/laporan/pdf" && request.method === "GET") return renderReport(url, env);

      // Kontrak lama yang masih dipakai oleh halaman Opname, Dashboard, Login, dan Laporan.
      if (url.pathname === "/" || url.pathname === "") {
        if (request.method === "GET") return legacyGet(url, env);
        if (request.method === "POST") return legacyPost(request, url, env);
      }
      return json({ success: false, message: "Endpoint tidak ditemukan" }, 404);
    } catch (error) {
      console.error(error);
      return json({ success: false, message: error?.message || "Server error" }, 500);
    }
  }
};

async function getBahan(env) {
  const { results } = await env.DB.prepare(`SELECT sku,nama,kategori,stok,satuan,min_stok AS minStok,expired FROM bahan ORDER BY nama COLLATE NOCASE ASC`).all();
  return json({ success: true, data: results || [] });
}

async function saveBahan(request, env) {
  const data = await request.json();
  const mode = data?.mode || "create";
  const sku = text(data?.sku), nama = text(data?.nama), kategori = text(data?.kategori), satuan = text(data?.satuan);
  const stok = Number(data?.stok ?? 0), minStok = Number(data?.minStok ?? 0);
  const expired = data?.expired ? String(data.expired) : null;
  if (!sku || !nama || !satuan) return json({ success: false, message: "SKU, nama bahan, dan satuan wajib diisi" }, 400);
  if (!Number.isFinite(stok) || !Number.isFinite(minStok)) return json({ success: false, message: "Stok atau minimum stok tidak valid" }, 400);
  if (mode === "update") {
    const result = await env.DB.prepare(`UPDATE bahan SET nama=?,kategori=?,stok=?,satuan=?,min_stok=?,expired=?,updated_at=datetime('now') WHERE sku=?`).bind(nama,kategori,stok,satuan,minStok,expired,sku).run();
    return result.meta?.changes ? json({ success: true, message: "Bahan berhasil diupdate" }) : json({ success: false, message: "SKU tidak ditemukan" }, 404);
  }
  try {
    await env.DB.prepare(`INSERT INTO bahan (sku,nama,kategori,stok,satuan,min_stok,expired) VALUES (?,?,?,?,?,?,?)`).bind(sku,nama,kategori,stok,satuan,minStok,expired).run();
    return json({ success: true, message: "Bahan berhasil ditambahkan" }, 201);
  } catch (error) {
    if (String(error?.message).toLowerCase().includes("unique")) return json({ success: false, message: "SKU sudah digunakan" }, 409);
    throw error;
  }
}

async function deleteBahan(request, env) {
  const { sku } = await request.json();
  if (!text(sku)) return json({ success: false, message: "SKU wajib diisi" }, 400);
  try {
    const result = await env.DB.prepare("DELETE FROM bahan WHERE sku=?").bind(text(sku)).run();
    return result.meta?.changes ? json({ success: true, message: "Bahan berhasil dihapus" }) : json({ success: false, message: "SKU tidak ditemukan" }, 404);
  } catch (error) {
    if (String(error?.message).toLowerCase().includes("foreign key")) return json({ success: false, message: "Bahan tidak bisa dihapus karena masih digunakan" }, 409);
    throw error;
  }
}

async function getTransaksi(url, env) {
  const clauses = [], args = [];
  const start = url.searchParams.get("startDate"), end = url.searchParams.get("endDate"), tipe = url.searchParams.get("filterTipe");
  if (start) { clauses.push("date(t.timestamp) >= date(?)"); args.push(start); }
  if (end) { clauses.push("date(t.timestamp) <= date(?)"); args.push(end); }
  if (tipe && tipe !== "all") { clauses.push("t.tipe = ?"); args.push(tipe); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { results } = await env.DB.prepare(`SELECT t.*, t.id_transaksi AS idTransaksi FROM transaksi t ${where} ORDER BY t.timestamp DESC`).bind(...args).all();
  return json({ success: true, data: results || [] });
}

async function saveTransaksi(request, env) {
  const d = await request.json();
  const tipe = text(d.tipe), sku = text(d.sku), qty = Number(d.qty), petugas = text(d.petugas), satuan = text(d.satuan);
  if (!["Masuk","Keluar","Rusak-Expired"].includes(tipe)) return json({ success:false, message:"Tipe transaksi tidak valid" },400);
  if (!sku || !Number.isFinite(qty) || qty <= 0) return json({ success:false, message:"SKU dan jumlah wajib valid" },400);
  const bahan = await env.DB.prepare("SELECT * FROM bahan WHERE sku=?").bind(sku).first();
  if (!bahan) return json({ success:false, message:"Bahan tidak ditemukan" },404);
  const delta = tipe === "Masuk" ? qty : -qty;
  const akhir = Number(bahan.stok) + delta;
  if (akhir < 0) return json({ success:false, message:"Stok tidak mencukupi" },400);
  const id = `TRX-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const ket = text(d.keterangan) || (tipe === "Masuk" && d.exp ? `Expired: ${d.exp}` : "");
  await env.DB.batch([
    env.DB.prepare("UPDATE bahan SET stok=?, expired=CASE WHEN ? <> '' THEN ? ELSE expired END, updated_at=datetime('now') WHERE sku=?").bind(akhir,text(d.exp),text(d.exp),sku),
    env.DB.prepare("INSERT INTO transaksi (id_transaksi,timestamp,tipe,sku,nama_bahan,qty,satuan,stok_awal,stok_akhir,keterangan,petugas) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id,new Date().toISOString(),tipe,sku,bahan.nama,qty,satuan || bahan.satuan,Number(bahan.stok),akhir,ket,petugas)
  ]);
  return json({ success:true, message:"Transaksi berhasil disimpan", idTransaksi:id });
}

async function cancelTransaksi(request, env) {
  const { idTransaksi } = await request.json();
  const trx = await env.DB.prepare("SELECT * FROM transaksi WHERE id_transaksi=?").bind(text(idTransaksi)).first();
  if (!trx) return json({ success:false, message:"Transaksi tidak ditemukan" },404);
  if (String(trx.keterangan).includes("[DIBATALKAN]")) return json({ success:false, message:"Transaksi sudah dibatalkan" },409);
  const bahan = await env.DB.prepare("SELECT * FROM bahan WHERE sku=?").bind(trx.sku).first();
  const reverse = trx.tipe === "Masuk" ? -Number(trx.qty) : Number(trx.qty);
  await env.DB.batch([
    env.DB.prepare("UPDATE bahan SET stok=stok+?, updated_at=datetime('now') WHERE sku=?").bind(reverse,trx.sku),
    env.DB.prepare("UPDATE transaksi SET keterangan=keterangan || ' [DIBATALKAN]' WHERE id_transaksi=?").bind(text(idTransaksi))
  ]);
  return json({ success:true, message:"Transaksi dibatalkan", stokTerakhir:bahan ? Number(bahan.stok)+reverse : null });
}

async function saveOpname(data, env) {
  const petugas = text(data?.petugas), items = Array.isArray(data?.items) ? data.items : [];
  if (!petugas || !items.length) return json({ success:false, message:"Petugas dan item opname wajib diisi" },400);
  const statements = [];
  for (const item of items) {
    const fisik = Number(item.stokFisik);
    if (!text(item.sku) || !Number.isFinite(fisik) || fisik < 0) return json({ success:false, message:`Nilai stok tidak valid (${item.sku || "SKU"})` },400);
    const bahan = await env.DB.prepare("SELECT * FROM bahan WHERE sku=?").bind(text(item.sku)).first();
    if (!bahan) return json({ success:false, message:`Bahan tidak ditemukan: ${item.sku}` },404);
    const selisih = fisik - Number(bahan.stok);
    const id = `OPN-${Date.now()}-${Math.random().toString(36).slice(2,7)}-${text(item.sku)}`;
    statements.push(env.DB.prepare("UPDATE bahan SET stok=?,updated_at=datetime('now') WHERE sku=?").bind(fisik,text(item.sku)));
    statements.push(env.DB.prepare("INSERT INTO transaksi (id_transaksi,timestamp,tipe,sku,nama_bahan,qty,satuan,stok_awal,stok_akhir,keterangan,petugas) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id,new Date().toISOString(),"Opname",text(item.sku),bahan.nama,selisih,bahan.satuan,Number(bahan.stok),fisik,"Stock Opname",petugas));
  }
  await env.DB.batch(statements);
  return json({ success:true, message:`Opname ${items.length} bahan berhasil disimpan` });
}

async function ensureResepTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS resep (id INTEGER PRIMARY KEY AUTOINCREMENT, produk TEXT NOT NULL, sku TEXT NOT NULL, qty_per_batch REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(produk, sku), FOREIGN KEY (sku) REFERENCES bahan(sku) ON UPDATE CASCADE ON DELETE RESTRICT)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_resep_produk ON resep(produk)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_resep_sku ON resep(sku)").run();
}
async function getResep(env) {
  try {
    await ensureResepTable(env);
    const { results } = await env.DB.prepare("SELECT r.produk,r.sku,r.qty_per_batch AS qtyPerBatch,b.nama,b.satuan,b.stok FROM resep r LEFT JOIN bahan b ON b.sku=r.sku ORDER BY r.produk,r.sku").all();
    return json({ success:true, data:results || [] });
  } catch (error) {
    return json({ success:false, message: error?.message || "Gagal mengambil resep" }, 500);
  }
}
async function saveResep(request, env) {
  await ensureResepTable(env);
  const d = await request.json(), produk=text(d.produk), sku=text(d.sku), qty=Number(d.qtyPerBatch);
  if (!produk || !sku || !Number.isFinite(qty) || qty <= 0) return json({success:false,message:"Produk, bahan, dan qty wajib valid"},400);
  const existing = await env.DB.prepare("SELECT 1 FROM resep WHERE produk=? AND sku=? LIMIT 1").bind(produk, sku).first();
  if (existing) {
    await env.DB.prepare("UPDATE resep SET qty_per_batch=? WHERE produk=? AND sku=?").bind(qty, produk, sku).run();
  } else {
    await env.DB.prepare("INSERT INTO resep (produk,sku,qty_per_batch) VALUES (?,?,?)").bind(produk, sku, qty).run();
  }
  return json({success:true,message:"Resep berhasil disimpan"});
}
async function deleteResep(request, env) { await ensureResepTable(env); const d=await request.json(); const r=await env.DB.prepare("DELETE FROM resep WHERE produk=? AND sku=?").bind(text(d.produk),text(d.sku)).run(); return json({success:Boolean(r.meta?.changes),message:"Resep dihapus"}); }
async function saveProduksi(request, env) {
  await ensureResepTable(env);
  const d=await request.json(), produk=text(d.produk), batch=Number(d.jumlahBatch), petugas=text(d.petugas);
  if (!produk || !Number.isFinite(batch) || batch <= 0) return json({success:false,message:"Produk dan jumlah batch wajib valid"},400);
  const {results}=await env.DB.prepare("SELECT r.*,b.nama,b.satuan,b.stok FROM resep r JOIN bahan b ON b.sku=r.sku WHERE r.produk=?").bind(produk).all();
  if (!results?.length) return json({success:false,message:"Resep produk tidak ditemukan"},404);
  for (const r of results) if (Number(r.stok) < Number(r.qty_per_batch)*batch) return json({success:false,message:`Stok ${r.nama} tidak mencukupi`},400);
  const id=`PRD-${Date.now()}`, statements=[];
  for (const r of results) { const qty=Number(r.qty_per_batch)*batch; statements.push(env.DB.prepare("UPDATE bahan SET stok=stok-?,updated_at=datetime('now') WHERE sku=?").bind(qty,r.sku)); statements.push(env.DB.prepare("INSERT INTO transaksi (id_transaksi,timestamp,tipe,sku,nama_bahan,qty,satuan,stok_awal,stok_akhir,keterangan,petugas) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(`${id}-${r.sku}`,new Date().toISOString(),"Keluar",r.sku,r.nama,qty,r.satuan,r.stok,Number(r.stok)-qty,`Produksi [${id}] ${produk} x${batch}`,petugas)); }
  await env.DB.batch(statements); return json({success:true,message:`Produksi ${produk} berhasil`});
}

async function legacyGet(url, env) {
  const action=url.searchParams.get("action");
  if (action === "getMasterData") { const r=await getBahan(env); return toLegacyArray(r); }
  if (action === "getDashboardData") { const {results}=await env.DB.prepare("SELECT * FROM bahan ORDER BY nama").all(); const now=Date.now(); const perhatian=(results||[]).filter(b=>Number(b.stok)<=Number(b.min_stok)||b.expired).map(b=>({...b,status:Number(b.stok)<=Number(b.min_stok)?"MENIPIS":"EXPIRED"})); return json({totalJenis:(results||[]).length,menipis:(results||[]).filter(b=>Number(b.stok)<=Number(b.min_stok)).length,expired:(results||[]).filter(b=>b.expired && new Date(b.expired).getTime()<now).length,expiredSoon:0,perhatian}); }
  if (action === "getRiwayat") { const r=await getTransaksi(url,env); return toLegacyArray(r); }
  if (action === "getUsers") { const {results}=await env.DB.prepare("SELECT email,nama,role FROM users ORDER BY nama").all(); return json(results||[]); }
  return json({success:false,message:"Action tidak ditemukan"},404);
}
async function legacyPost(request,url,env) { const body=await request.json(); const action=body?.action, data=body?.data||{}; if(action==="saveOpname") return saveOpname(data,env); if(action==="loginPetugas"){const u=await env.DB.prepare("SELECT nama,role FROM users WHERE nama=? AND pin=?").bind(text(data.nama),text(data.pin)).first(); return u?json({success:true,nama:u.nama,role:u.role}):json({success:false,message:"Nama atau PIN salah"},401);} if(action==="generateLaporan"){const p=new URL(url); p.pathname="/api/laporan/pdf"; p.search=new URLSearchParams({tanggal:text(data.tanggal),tipe:text(data.tipe),petugas:text(data.petugas)}).toString(); return json({success:true,pdfUrl:p.toString()});} return json({success:false,message:"Action tidak ditemukan"},404); }
async function toLegacyArray(response) { const body=await response.json(); return json(body.data || body.results || body); }
async function renderReport(url, env) {
  const tipe = url.searchParams.get("tipe") || "daily";
  const tanggal = url.searchParams.get("tanggal") || new Date().toISOString().slice(0, 10);
  const range = reportRange(tipe, tanggal);
  const { results: bahan } = await env.DB.prepare("SELECT * FROM bahan ORDER BY nama COLLATE NOCASE").all();
  const { results: transaksi } = await env.DB.prepare("SELECT * FROM transaksi WHERE date(timestamp) >= date(?) AND date(timestamp) <= date(?) ORDER BY timestamp").bind(range.start, range.end).all();
  const all = transaksi || [];
  const active = all.filter(r => !String(r.keterangan || "").includes("[DIBATALKAN]"));
  const opname = active.filter(r => r.tipe === "Opname" || String(r.keterangan || "").startsWith("Stock Opname"));
  const masuk = active.filter(r => r.tipe === "Masuk");
  const keluar = active.filter(r => r.tipe === "Keluar" && !String(r.keterangan || "").startsWith("Produksi"));
  const produksi = active.filter(r => r.tipe === "Keluar" && String(r.keterangan || "").startsWith("Produksi"));
  const rusak = active.filter(r => r.tipe === "Rusak-Expired");
  const low = (bahan || []).filter(b => Number(b.stok) <= Number(b.min_stok));
  const expired = (bahan || []).filter(b => b.expired);
  const title = reportTitle(tipe);
  const productionUsage = aggregateByUnit(produksi);
  const sections = tipe === "opname" ? reportOpnameSection(opname) : [
    reportSummary(bahan || [], low, expired),
    reportInventorySection(bahan || []),
    reportTotalsSection(active),
    reportListSection("Stok Menipis", low.length ? low.map(b => `${esc(b.nama)} (${fmtNum(b.stok)} ${esc(b.satuan)})`).join("") : emptyBlock("Tidak ada.")),
    reportListSection("Expired / Hampir Expired", expired.length ? expired.map(b => `<li>${esc(b.nama)} — ${esc(b.expired)}</li>`).join("") : emptyBlock("Tidak ada.")),
    reportActivitySection("Barang Masuk", masuk),
    reportActivitySection("Barang Keluar", keluar),
    reportActivitySection("Produksi", produksi),
    reportProductionSection(productionUsage),
    reportOpnameSection(opname),
    reportActivitySection("Rusak / Expired", rusak)
  ].join("");
  const generated = new Date();
  const reportId = `RPT-${generated.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eee;font-family:Arial,Helvetica,sans-serif;color:#222}.page{max-width:980px;margin:20px auto;background:#fff;padding:34px 42px;box-shadow:0 2px 10px #0002}.toolbar{max-width:980px;margin:14px auto;display:flex;gap:8px}.toolbar button{background:#111;color:#fff;border:0;border-radius:7px;padding:10px 16px;font-weight:700}.banner{width:100%;max-height:130px;object-fit:cover;border-radius:8px;background:#111}.title{text-align:center;font-size:22px;letter-spacing:.5px;margin:18px 0 8px}.meta{text-align:center;color:#6b625d;font-size:12px;margin-bottom:22px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0 20px}.card{background:#faf6f1;border-radius:8px;padding:10px;text-align:center}.card b{display:block;font-size:20px}.card span{font-size:11px;color:#796d65}.section{margin:20px 0}.section h2{font-size:16px;color:#5c3d2e;border-bottom:2px solid #eadfd7;padding-bottom:6px}.section ul{margin:8px 0;padding-left:22px}.empty{color:#777;font-style:italic;padding:7px 0}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:11px}th{background:#5c3d2e;color:white}th,td{border:1px solid #d8cec7;padding:6px;text-align:left;vertical-align:top}.total-row th,.total-row td{background:#f3e8df;color:#4b3024;font-weight:700}tr{break-inside:avoid}.sign{margin-top:32px;width:230px;text-align:center}.signline{border-bottom:1px solid #333;height:34px;margin-bottom:7px}.footer{border-top:1px solid #ddd;margin-top:26px;padding-top:8px;text-align:center;color:#888;font-size:10px}@media(max-width:620px){.page{margin:0;padding:18px 14px;box-shadow:none}.toolbar{margin:0;padding:10px 14px;background:#eee}.summary{grid-template-columns:repeat(2,1fr)}table{font-size:10px}}@media print{body{background:#fff}.toolbar{display:none}.page{margin:0;max-width:none;box-shadow:none;padding:20px}.section{break-inside:avoid}.banner{print-color-adjust:exact;-webkit-print-color-adjust:exact}th,.card{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">Cetak / Simpan PDF</button><button onclick="window.close()">Tutup</button></div><main class="page"><img class="banner" src="/header.webp" alt="Roti Boss"><h1 class="title">${esc(title)}</h1><div class="meta">Periode: ${esc(range.label)} &nbsp; | &nbsp; Dibuat: ${esc(generated.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }))}<br>Kode Laporan: ${esc(reportId)}</div>${sections}<div class="sign"><div class="signline"></div>Petugas / Penanggung Jawab</div><div class="footer">${esc(reportId)} • Laporan Gudang Roti Boss</div></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...cors() } });
}
function reportRange(tipe, tanggal) {
  const base = new Date(`${tanggal}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return { start: tanggal, end: tanggal, label: tanggal };
  if (tipe === "monthly") { const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)); const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)); return rangeObj(start, end); }
  if (tipe === "weekly") { const day = base.getUTCDay(); const diff = day === 0 ? -6 : 1 - day; const start = new Date(base); start.setUTCDate(base.getUTCDate() + diff); const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6); return rangeObj(start, end); }
  return rangeObj(base, base);
}
function rangeObj(start, end) { const iso = d => d.toISOString().slice(0, 10); return { start: iso(start), end: iso(end), label: `${iso(start)} s/d ${iso(end)}` }; }
function reportTitle(tipe) { return ({ daily: "Laporan Harian", weekly: "Laporan Mingguan", monthly: "Laporan Bulanan", opname: "Laporan Stock Opname" })[tipe] || "Laporan Gudang"; }
function fmtNum(value) { const n = Number(value) || 0; return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))); }
function emptyBlock(textValue) { return `<div class="empty">${textValue}</div>`; }
function reportSummary(bahan, low, expired) { return `<section class="summary"><div class="card"><b>${bahan.length}</b><span>Total Jenis Bahan</span></div><div class="card"><b>${low.length}</b><span>Stok Menipis</span></div><div class="card"><b>${expired.length}</b><span>Expired / Segera</span></div><div class="card"><b>${fmtNum(bahan.reduce((sum, b) => sum + (Number(b.stok) || 0), 0))}</b><span>Total Stok</span></div></section>`; }
function reportInventorySection(rows) { if (!rows.length) return `<section class="section"><h2>Daftar Inventaris (0)</h2>${emptyBlock("Belum ada bahan.")}</section>`; const body = rows.map((b, i) => { const stok = Number(b.stok) || 0; const min = Number(b.min_stok) || 0; const status = stok <= min ? "Menipis" : b.expired ? "Expired" : "Aman"; return `<tr><td>${i + 1}</td><td>${esc(b.sku)}</td><td>${esc(b.nama)}</td><td>${esc(b.kategori || "-")}</td><td>${fmtNum(stok)}</td><td>${esc(b.satuan)}</td><td>${fmtNum(min)}</td><td>${esc(b.expired || "-")}</td><td>${status}</td></tr>`; }).join(""); return `<section class="section"><h2>Daftar Inventaris (${rows.length})</h2><div class="table-wrap"><table><thead><tr><th>No</th><th>SKU</th><th>Nama Bahan</th><th>Kategori</th><th>Stok</th><th>Satuan</th><th>Min.</th><th>Expired</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div></section>`; }
function reportTotalsSection(rows) { const groups = ["Masuk", "Keluar", "Rusak-Expired", "Opname"]; const data = groups.map(tipe => { const subset = rows.filter(r => r.tipe === tipe && !(tipe === "Keluar" && String(r.keterangan || "").startsWith("Produksi"))); return { tipe, count: subset.length, qty: subset.reduce((sum, r) => sum + Math.abs(Number(r.qty) || 0), 0) }; }); const produksi = rows.filter(r => r.tipe === "Keluar" && String(r.keterangan || "").startsWith("Produksi")); data.splice(2, 0, { tipe: "Produksi", count: produksi.length, qty: produksi.reduce((sum, r) => sum + Math.abs(Number(r.qty) || 0), 0) }); return `<section class="section"><h2>Ringkasan Transaksi</h2><div class="table-wrap"><table><thead><tr><th>Jenis</th><th>Jumlah Transaksi</th><th>Total Qty</th></tr></thead><tbody>${data.map(r => `<tr><td>${r.tipe}</td><td>${r.count}</td><td>${fmtNum(r.qty)}</td></tr>`).join("")}<tr class="total-row"><th>Total</th><th>${data.reduce((s, r) => s + r.count, 0)}</th><th>${fmtNum(data.reduce((s, r) => s + r.qty, 0))}</th></tr></tbody></table></div></section>`; }
function reportListSection(title, content) { const list = content.startsWith("<li>") ? `<ul>${content}</ul>` : content; return `<section class="section"><h2>${title}</h2>${list}</section>`; }
function reportActivitySection(title, rows) { if (!rows.length) return `<section class="section"><h2>${title} (0)</h2>${emptyBlock("Tidak ada.")}</section>`; const total = rows.reduce((sum, r) => sum + Math.abs(Number(r.qty) || 0), 0); const body = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(formatTime(r.timestamp))}</td><td>${esc(r.nama_bahan)}</td><td>${fmtNum(r.qty)}</td><td>${esc(r.satuan)}</td><td>${esc(r.petugas)}</td><td>${esc(cleanKeterangan(r.keterangan))}</td></tr>`).join(""); return `<section class="section"><h2>${title} (${rows.length})</h2><div class="table-wrap"><table><thead><tr><th>No</th><th>Waktu</th><th>Bahan</th><th>Jumlah</th><th>Satuan</th><th>Petugas</th><th>Keterangan</th></tr></thead><tbody>${body}</tbody><tfoot><tr class="total-row"><th colspan="3">Total</th><th>${fmtNum(total)}</th><th colspan="3">${rows.length} transaksi</th></tr></tfoot></table></div></section>`; }
function reportOpnameSection(rows) { if (!rows.length) return `<section class="section"><h2>Stock Opname (0)</h2>${emptyBlock("Tidak ada.")}</section>`; const body = rows.map((r, i) => { const sistem = Number(r.stok_awal) || 0, fisik = Number(r.stok_akhir) || 0, selisih = fisik - sistem; const status = selisih === 0 ? "Sesuai" : selisih > 0 ? "Selisih Masuk" : "Selisih Keluar"; return `<tr><td>${i + 1}</td><td>${esc(formatTime(r.timestamp))}</td><td>${esc(r.nama_bahan)}</td><td>${fmtNum(sistem)}</td><td>${fmtNum(fisik)}</td><td>${selisih > 0 ? "+" : ""}${fmtNum(selisih)}</td><td>${esc(r.satuan)}</td><td>${esc(r.petugas)}</td><td>${status}</td></tr>`; }).join(""); const sesuai = rows.filter(r => (Number(r.stok_akhir) || 0) === (Number(r.stok_awal) || 0)).length; return `<section class="section"><h2>Stock Opname (${rows.length})</h2><div class="table-wrap"><table><thead><tr><th>No</th><th>Waktu</th><th>Bahan</th><th>Sistem</th><th>Fisik</th><th>Selisih</th><th>Satuan</th><th>Petugas</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div><p>Hasil opname: ${rows.length} bahan diperiksa, ${sesuai} sesuai, ${rows.length - sesuai} memiliki selisih.</p></section>`; }
function reportProductionSection(rows) { if (!rows.length) return `<section class="section"><h2>Total Penggunaan Bahan Produksi</h2>${emptyBlock("Tidak ada penggunaan bahan produksi.")}</section>`; return `<section class="section"><h2>Total Penggunaan Bahan Produksi</h2><div class="table-wrap"><table><thead><tr><th>Bahan</th><th>Total</th><th>Satuan</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.nama)}</td><td>${fmtNum(r.qty)}</td><td>${esc(r.satuan)}</td></tr>`).join("")}</tbody></table></div></section>`; }
function aggregateByUnit(rows) { const map = new Map(); for (const r of rows) { const key = `${r.nama_bahan}|${r.satuan}`; const item = map.get(key) || { nama: r.nama_bahan, satuan: r.satuan, qty: 0 }; item.qty += Number(r.qty) || 0; map.set(key, item); } return [...map.values()]; }
function formatTime(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value || "-") : d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" }); }
function cleanKeterangan(value) { const s = String(value || "-"); const match = s.match(/^Produksi\s+\[PRD-[^\]]+\]\s+(.+)$/i); return match ? match[1] : s; }
function text(v){return String(v??"").trim();}
function esc(v){return text(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function json(data,status=200,extraHeaders={}){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8",...cors(),...extraHeaders}});}
function cors(){return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, DELETE, OPTIONS","Access-Control-Allow-Headers":"Accept, Cache-Control, Content-Type"};}
