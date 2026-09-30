import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type MemoryRow = {
  id: string;
  memory_key: string;
  memory_value: string;
  source: string;
  importance: number;
  created_at: string;
  updated_at: string;
};

export type MemoryResult<T> = { ok: boolean; error?: string; data?: T };

const ownerSchema = z.string().min(6).max(80);

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const listMemories = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ ownerKey: ownerSchema }).parse(data))
  .handler(async ({ data }): Promise<MemoryResult<MemoryRow[]>> => {
    const db = await admin();
    const { data: rows, error } = await db
      .from("companion_memories")
      .select("id, memory_key, memory_value, source, importance, created_at, updated_at")
      .eq("owner_key", data.ownerKey)
      .order("updated_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (rows ?? []) as MemoryRow[] };
  });

export const saveMemory = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        ownerKey: ownerSchema,
        key: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1).max(1000),
        source: z.string().max(40).default("manual"),
        importance: z.number().int().min(1).max(5).default(1),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<MemoryResult<MemoryRow>> => {
    const db = await admin();
    const { data: row, error } = await db
      .from("companion_memories")
      .upsert(
        {
          owner_key: data.ownerKey,
          memory_key: data.key,
          memory_value: data.value,
          source: data.source,
          importance: data.importance,
        },
        { onConflict: "owner_key,memory_key" },
      )
      .select("id, memory_key, memory_value, source, importance, created_at, updated_at")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: row as MemoryRow };
  });

export const forgetMemory = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ ownerKey: ownerSchema, id: z.string().uuid() }).parse(data))
  .handler(async ({ data }): Promise<MemoryResult<{ id: string }>> => {
    const db = await admin();
    const { data: rows, error } = await db
      .from("companion_memories")
      .delete()
      .eq("owner_key", data.ownerKey)
      .eq("id", data.id)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!rows || rows.length === 0) return { ok: false, error: "That memory no longer exists." };
    return { ok: true, data: { id: data.id } };
  });

export const clearMemories = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ ownerKey: ownerSchema }).parse(data))
  .handler(async ({ data }): Promise<MemoryResult<{ removed: number }>> => {
    const db = await admin();
    const { data: rows, error } = await db
      .from("companion_memories")
      .delete()
      .eq("owner_key", data.ownerKey)
      .select("id");
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { removed: rows?.length ?? 0 } };
  });
