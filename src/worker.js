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

async function getResep(env) {
  const { results } = await env.DB.prepare("SELECT r.id,r.produk,r.sku,r.qty_per_batch AS qtyPerBatch,b.nama,b.satuan,b.stok FROM resep r LEFT JOIN bahan b ON b.sku=r.sku ORDER BY r.produk,r.id").all();
  return json({ success:true, data:results || [] });
}
async function saveResep(request, env) {
  const d = await request.json(), produk=text(d.produk), sku=text(d.sku), qty=Number(d.qtyPerBatch);
  if (!produk || !sku || !Number.isFinite(qty) || qty <= 0) return json({success:false,message:"Produk, bahan, dan qty wajib valid"},400);
  await env.DB.prepare("INSERT INTO resep (produk,sku,qty_per_batch) VALUES (?,?,?) ON CONFLICT(produk,sku) DO UPDATE SET qty_per_batch=excluded.qty_per_batch,updated_at=datetime('now')").bind(produk,sku,qty).run();
  return json({success:true,message:"Resep berhasil disimpan"});
}
async function deleteResep(request, env) { const d=await request.json(); const r=await env.DB.prepare("DELETE FROM resep WHERE produk=? AND sku=?").bind(text(d.produk),text(d.sku)).run(); return json({success:Boolean(r.meta?.changes),message:"Resep dihapus"}); }
async function saveProduksi(request, env) {
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
async function renderReport(url,env){const tipe=url.searchParams.get("tipe")||"daily", tanggal=url.searchParams.get("tanggal")||new Date().toISOString().slice(0,10); const {results}=await env.DB.prepare("SELECT * FROM transaksi WHERE date(timestamp)=date(?) ORDER BY timestamp").bind(tanggal).all(); const rows=(results||[]).map(r=>`<tr><td>${esc(r.timestamp)}</td><td>${esc(r.tipe)}</td><td>${esc(r.nama_bahan)}</td><td>${r.qty}</td><td>${esc(r.satuan)}</td><td>${esc(r.petugas)}</td></tr>`).join(""); return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Laporan ${esc(tanggal)}</title><style>body{font-family:Arial;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px;text-align:left}@media print{button{display:none}}</style></head><body><button onclick="print()">Cetak / Simpan PDF</button><h1>Laporan Gudang Roti Boss</h1><p>Tanggal: ${esc(tanggal)} | Jenis: ${esc(tipe)}</p><table><thead><tr><th>Waktu</th><th>Tipe</th><th>Bahan</th><th>Qty</th><th>Satuan</th><th>Petugas</th></tr></thead><tbody>${rows||"<tr><td colspan=6>Tidak ada transaksi</td></tr>"}</tbody></table></body></html>`,{headers:{"Content-Type":"text/html; charset=utf-8",...cors()}}); }
function text(v){return String(v??"").trim();}
function esc(v){return text(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function json(data,status=200,extraHeaders={}){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8",...cors(),...extraHeaders}});}
function cors(){return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, DELETE, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};}
