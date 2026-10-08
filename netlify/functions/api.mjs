import { getConnectionString } from "@netlify/database";
import pg from "pg";

pg.types.setTypeParser(1082, (v) => v); // keep DATE columns as plain text
let pool;

const T = {
  supplier: { pk: "supplier_id", cols: ["name", "contact_name", "email", "phone"] },
  bean: { pk: "bean_id", cols: ["name", "origin_country", "roast_level", "stock_kg", "reorder_level_kg"] },
  customer: { pk: "customer_id", cols: ["first_name", "last_name", "email", "phone"] },
  bean_order: { pk: "bean_order_id", cols: ["supplier_id", "order_date", "expected_date", "status", "notes"] },
  bean_order_item: { pk: "bean_order_item_id", cols: ["bean_order_id", "bean_id", "quantity_kg", "price_per_kg"] },
};
const L = {
  supplier: "SELECT * FROM supplier ORDER BY name",
  bean: "SELECT *, (stock_kg <= reorder_level_kg) AS low FROM bean ORDER BY name",
  customer: "SELECT * FROM customer ORDER BY last_name, first_name",
  bean_order: `SELECT o.*, s.name AS supplier_name,
      COALESCE((SELECT SUM(i.quantity_kg * i.price_per_kg) FROM bean_order_item i WHERE i.bean_order_id = o.bean_order_id), 0) AS total
    FROM bean_order o JOIN supplier s ON s.supplier_id = o.supplier_id
    ORDER BY o.order_date DESC, o.bean_order_id DESC`,
  bean_order_item: `SELECT i.*, b.name AS bean_name, i.quantity_kg * i.price_per_kg AS line_total
    FROM bean_order_item i JOIN bean b ON b.bean_id = i.bean_id
    WHERE i.bean_order_id = $1 ORDER BY b.name`,
};
const MSG = {
  23001: "That record is used by other records (for example a supplier with orders), so it can't be deleted.",
  23503: "That record is linked to other records, so it can't be deleted (or the linked record doesn't exist).",
  23505: "That value already exists. It must be unique.",
  23502: "A required field is empty.",
  23514: "A value is out of range or not allowed (for example, stock can't go below zero).",
  "22P02": "A number or date is not in a valid format.",
  22003: "A number is too large.",
  22007: "A date is not in a valid format.",
  22008: "A date is not in a valid format.",
};
const LOCK = "This order is already Received, so its items are locked. Change the status back to Ordered first.";
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

async function orderIsReceived(orderId) {
  if (!orderId) return false;
  const r = await pool.query("SELECT 1 FROM bean_order WHERE bean_order_id = $1 AND status = 'Received'", [orderId]);
  return r.rowCount > 0;
}
async function parentOrderOfItem(id) {
  const r = await pool.query("SELECT bean_order_id FROM bean_order_item WHERE bean_order_item_id = $1", [id]);
  return r.rows[0]?.bean_order_id;
}

export default async (req) => {
  pool ??= new pg.Pool({ connectionString: await getConnectionString(), max: 3 });
  const u = new URL(req.url);
  const [, , table, id] = u.pathname.split("/");
  const t = T[table];
  if (!t) return json({ error: "Unknown table" }, 404);
  try {
    if (req.method === "GET") {
      const r = await pool.query(L[table], table === "bean_order_item" ? [u.searchParams.get("order")] : []);
      return json(r.rows);
    }
    if (req.method === "DELETE") {
      if (table === "bean_order_item" && (await orderIsReceived(await parentOrderOfItem(id)))) return json({ error: LOCK }, 400);
      if (table === "bean_order" && (await orderIsReceived(id)))
        return json({ error: "Received orders already added stock, so they can't be deleted. Change the status first." }, 400);
      await pool.query(`DELETE FROM ${table} WHERE ${t.pk} = $1`, [id]);
      return json({ ok: true });
    }
    const b = await req.json();
    if (req.method === "PUT" && table === "bean_order_item") delete b.bean_order_id;
    const val = (c) => (b[c] === "" ? null : b[c]);
    if (table === "bean_order_item") {
      const oid = req.method === "POST" ? b.bean_order_id : await parentOrderOfItem(id);
      if (await orderIsReceived(oid)) return json({ error: LOCK }, 400);
    }
    if (req.method === "POST") {
      const ks = t.cols.filter((c) => b[c] !== undefined && val(c) !== null);
      const r = await pool.query(
        `INSERT INTO ${table} (${ks.join(",")}) VALUES (${ks.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
        ks.map(val)
      );
      return json(r.rows[0], 201);
    }
    if (req.method === "PUT") {
      const ks = t.cols.filter((c) => b[c] !== undefined);
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        let old;
        if (table === "bean_order") old = (await c.query("SELECT status FROM bean_order WHERE bean_order_id = $1 FOR UPDATE", [id])).rows[0]?.status;
        const r = await c.query(
          `UPDATE ${table} SET ${ks.map((k, i) => `${k} = $${i + 1}`).join(",")} WHERE ${t.pk} = $${ks.length + 1} RETURNING *`,
          [...ks.map(val), id]
        );
        if (table === "bean_order" && old && b.status && old !== b.status) {
          const dir = b.status === "Received" ? 1 : old === "Received" ? -1 : 0;
          if (dir)
            await c.query(
              "UPDATE bean SET stock_kg = stock_kg + $1::numeric * i.quantity_kg FROM bean_order_item i WHERE i.bean_id = bean.bean_id AND i.bean_order_id = $2",
              [dir, id]
            );
        }
        await c.query("COMMIT");
        return json(r.rows[0]);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: MSG[e.code] || "Something went wrong. Please check your entries and try again." }, 400);
  }
};

export const config = { path: "/api/*" };
