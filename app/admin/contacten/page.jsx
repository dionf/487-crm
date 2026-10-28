import { redirect } from "next/navigation";

// Het contactoverzicht is opgegaan in Relaties (bedrijven met contacten).
export default function ContactenPage() {
  redirect("/relaties");
}
