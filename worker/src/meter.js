// Per-request D1 accounting. Wraps env.DB so every prepare/bind/all/run/first/batch adds its
// meta.rows_read / meta.rows_written to one meter; index.js returns the totals as the
// x-d1-rows-read / x-d1-rows-written response headers (the free plan caps both per day).
export function meteredDB(db, meter) {
  const add = (res) => {
    const m = res && res.meta;
    if (m) { meter.read += m.rows_read || 0; meter.written += m.rows_written || 0; }
    return res;
  };
  const wrap = (stmt) => ({
    __stmt: stmt,
    bind: (...args) => wrap(stmt.bind(...args)),
    all: async () => add(await stmt.all()),
    run: async () => add(await stmt.run()),
    // .first() returns no meta, so it runs as .all() and picks the first row (callers only
    // use it on single-row queries).
    first: async (col) => {
      const row = add(await stmt.all()).results[0];
      if (row === undefined) return null;
      return col === undefined ? row : row[col] ?? null;
    },
    raw: (...args) => stmt.raw(...args),
  });
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: async (stmts) => {
      const results = await db.batch(stmts.map((s) => s.__stmt || s));
      results.forEach(add);
      return results;
    },
    exec: (sql) => db.exec(sql),
  };
}

export function withMeterHeaders(res, meter) {
  let out = res;
  try {
    res.headers.set("x-d1-rows-read", String(meter.read));
  } catch {
    out = new Response(res.body, res); // immutable headers (e.g. a fetched response)
    out.headers.set("x-d1-rows-read", String(meter.read));
  }
  out.headers.set("x-d1-rows-written", String(meter.written));
  return out;
}
