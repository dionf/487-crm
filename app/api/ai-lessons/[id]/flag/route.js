import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// POST /api/ai-lessons/[id]/flag — elke user mag één flag zetten per lesson
// Bij 2e unieke user-flag: lesson wordt automatisch gedeactiveerd (soft-rollback)
export async function POST(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const userId = request.headers.get("x-auth-user-id");
  if (!tenant || !userId) {
    return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id } = await params;

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* body optional */
  }

  // Verify lesson bestaat en hoort bij deze tenant
  const { data: lesson } = await supabase
    .from("ai_quote_lessons")
    .select("id, tenant, flag_count")
    .eq("id", id)
    .single();

  if (!lesson || lesson.tenant !== tenant) {
    return Response.json({ error: "Regel niet gevonden" }, { status: 404 });
  }

  // Insert flag (PK enforced — dezelfde user kan niet 2x flaggen)
  const { error: flagErr } = await supabase
    .from("ai_quote_lesson_flags")
    .insert({
      lesson_id: id,
      user_id: userId,
      reason: body.reason || null,
    });

  if (flagErr) {
    // Duplicate key → user heeft al eerder geflagd
    if (flagErr.code === "23505") {
      return Response.json({ error: "Je hebt deze regel al geflagd" }, { status: 409 });
    }
    return Response.json({ error: flagErr.message }, { status: 500 });
  }

  // Tel alle flags voor deze lesson
  const { count } = await supabase
    .from("ai_quote_lesson_flags")
    .select("lesson_id", { count: "exact", head: true })
    .eq("lesson_id", id);

  const newFlagCount = count || 0;

  // Update flag_count op de lesson, en auto-deactiveer vanaf 2
  const update = { flag_count: newFlagCount, updated_at: new Date().toISOString() };
  if (newFlagCount >= 2) update.is_active = false;

  await supabase.from("ai_quote_lessons").update(update).eq("id", id);

  return Response.json({
    success: true,
    flag_count: newFlagCount,
    auto_deactivated: newFlagCount >= 2,
  });
}

// DELETE — verwijder je eigen flag (tel naar beneden)
export async function DELETE(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const userId = request.headers.get("x-auth-user-id");
  if (!tenant || !userId) {
    return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id } = await params;

  await supabase
    .from("ai_quote_lesson_flags")
    .delete()
    .eq("lesson_id", id)
    .eq("user_id", userId);

  const { count } = await supabase
    .from("ai_quote_lesson_flags")
    .select("lesson_id", { count: "exact", head: true })
    .eq("lesson_id", id);

  await supabase
    .from("ai_quote_lessons")
    .update({ flag_count: count || 0, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant", tenant);

  return Response.json({ success: true, flag_count: count || 0 });
}
