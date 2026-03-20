import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data: metrics, error } = await supabase
    .from("pipeline_metrics")
    .select("*");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ metrics });
}
