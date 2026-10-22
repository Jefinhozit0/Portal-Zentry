/**
 * In-memory stand-in for the Supabase client, for the demo copy of the portal (video, sales demos).
 * It implements the part of the API the server uses: tables (select/insert/update/delete with the
 * usual filters), Storage and the auth admin calls. Nothing leaves this process.
 */
import { seed } from "./seed";

type Row = Record<string, any>;
type Result = { data: any; error: { message: string; code?: string } | null; count?: number | null };

const db: Record<string, Row[]> = seed.tables;
const files = new Map<string, Buffer>();
const users: Row[] = seed.users;

const nextId = (table: string) => (db[table] ?? []).reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
const like = (pattern: string) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");

class Query implements PromiseLike<Result> {
  private filters: ((row: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row[] | Row | null = null;
  private columns = "*";
  private returning = false;
  private orders: { column: string; ascending: boolean }[] = [];
  private limitTo: number | null = null;
  private rangeFrom = 0;
  private mode: "many" | "single" | "maybe" = "many";
  private countOnly = false;

  constructor(private table: string) {
    db[table] ??= [];
  }

  select(columns = "*", options?: { count?: string; head?: boolean }) {
    this.columns = columns;
    if (this.op !== "select") this.returning = true;
    if (options?.head) this.countOnly = true;
    return this;
  }
  insert(rows: Row[] | Row) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows: Row[] | Row) { this.op = "upsert"; this.payload = rows; return this; }
  update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }

  eq(column: string, value: unknown) { this.filters.push((row) => String(row[column]) === String(value)); return this; }
  neq(column: string, value: unknown) { this.filters.push((row) => String(row[column]) !== String(value)); return this; }
  in(column: string, values: unknown[]) { const set = new Set(values.map(String)); this.filters.push((row) => set.has(String(row[column]))); return this; }
  ilike(column: string, pattern: string) { const re = like(pattern); this.filters.push((row) => re.test(String(row[column] ?? ""))); return this; }
  gt(column: string, value: any) { this.filters.push((row) => row[column] > value); return this; }
  gte(column: string, value: any) { this.filters.push((row) => row[column] >= value); return this; }
  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) this.filters.push((row) => row[column] !== null && row[column] !== undefined);
    return this;
  }
  /** Only the "a.eq.x,b.eq.y" form, which is what the portal uses. */
  or(expression: string) {
    const parts = expression.split(",").map((part) => part.split(".")).filter((part) => part.length >= 3);
    this.filters.push((row) => parts.some(([column, operator, ...rest]) => {
      const value = rest.join(".");
      if (operator === "eq") return String(row[column]) === value;
      if (operator === "ilike") return like(value.replace(/\*/g, "%")).test(String(row[column] ?? ""));
      if (operator === "is" && value === "null") return row[column] == null;
      return false;
    }));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) { this.orders.push({ column, ascending: options?.ascending !== false }); return this; }
  limit(n: number) { this.limitTo = n; return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.limitTo = to - from + 1; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  private matching() { return db[this.table].filter((row) => this.filters.every((test) => test(row))); }

  /** "id, nome, clientes(name)" → the row with the related client's columns embedded. */
  private shape(row: Row) {
    const embed = this.columns.match(/(\w+)\(([^)]*)\)/);
    if (!embed) return { ...row };
    const [, relation, cols] = embed;
    const related = (db[relation] ?? []).find((other) => String(other.id) === String(row.client_id ?? row.cliente_id));
    const picked = related ? Object.fromEntries(cols.split(",").map((c) => c.trim()).map((c) => [c, related[c]])) : null;
    return { ...row, [relation]: picked };
  }

  private run(): Result {
    const now = new Date().toISOString();
    let rows: Row[];
    if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      rows = list.map((item) => {
        const existing = this.op === "upsert" && item.id != null ? db[this.table].find((row) => String(row.id) === String(item.id)) : undefined;
        if (existing) return Object.assign(existing, item);
        const row = { id: nextId(this.table), created_at: now, ...item };
        db[this.table].push(row);
        return row;
      });
      if (!this.returning) return { data: null, error: null };
    } else if (this.op === "update") {
      rows = this.matching();
      rows.forEach((row) => Object.assign(row, this.payload));
      if (!this.returning) return { data: null, error: null };
    } else if (this.op === "delete") {
      const gone = new Set(this.matching());
      db[this.table] = db[this.table].filter((row) => !gone.has(row));
      return { data: this.returning ? [...gone] : null, error: null };
    } else {
      rows = this.matching();
    }
    for (const { column, ascending } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => (a[column] === b[column] ? 0 : (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1)));
    }
    const count = rows.length;
    if (this.countOnly) return { data: null, error: null, count };
    rows = rows.slice(this.rangeFrom, this.limitTo === null ? undefined : this.rangeFrom + this.limitTo).map((row) => this.shape(row));
    if (this.mode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "Row not found", code: "PGRST116" } };
    if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null, count };
  }

  then<A = Result, B = never>(onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onRejected?: ((reason: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(onFulfilled, onRejected);
  }
}

const storageBucket = (bucket: string) => ({
  upload: async (path: string, bytes: Buffer) => { files.set(`${bucket}/${path}`, Buffer.from(bytes)); return { data: { path }, error: null }; },
  download: async (path: string) => {
    const bytes = files.get(`${bucket}/${path}`) ?? seed.files[`${bucket}/${path}`];
    return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: "Object not found" } };
  },
  remove: async (paths: string[]) => { paths.forEach((path) => files.delete(`${bucket}/${path}`)); return { data: null, error: null }; },
  createSignedUrl: async (path: string) => ({ data: { signedUrl: `/demo-arquivo/${encodeURIComponent(`${bucket}/${path}`)}` }, error: null }),
  list: async () => ({ data: [], error: null }),
});

export const supabase = {
  from: (table: string) => new Query(table),
  rpc: async () => ({ data: null, error: { message: "Não disponível na demonstração." } }),
  storage: { from: storageBucket, listBuckets: async () => ({ data: [], error: null }) },
  auth: {
    getUser: async (token: string) => {
      const user = users.find((candidate) => candidate.token === token);
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid token" } };
    },
    admin: {
      listUsers: async () => ({ data: { users }, error: null }),
      getUserById: async (id: string) => ({ data: { user: users.find((user) => user.id === id) ?? null }, error: null }),
      updateUserById: async (id: string, patch: Row) => {
        const user = users.find((candidate) => candidate.id === id);
        if (user) {
          if (patch.app_metadata) user.app_metadata = { ...user.app_metadata, ...patch.app_metadata };
          if (patch.user_metadata) user.user_metadata = { ...user.user_metadata, ...patch.user_metadata };
        }
        return { data: { user }, error: null };
      },
      createUser: async (attrs: Row) => {
        const user = { id: `demo-${users.length + 1}`, created_at: new Date().toISOString(), email: attrs.email, app_metadata: attrs.app_metadata ?? {}, user_metadata: attrs.user_metadata ?? {} };
        users.push(user);
        return { data: { user }, error: null };
      },
      deleteUser: async (id: string) => { const index = users.findIndex((user) => user.id === id); if (index >= 0) users.splice(index, 1); return { data: null, error: null }; },
      generateLink: async () => ({ data: { properties: { action_link: "#" } }, error: null }),
    },
  },
};

/** Files the demo serves through its signed links. */
export const demoFile = (key: string) => files.get(key) ?? seed.files[key] ?? null;
