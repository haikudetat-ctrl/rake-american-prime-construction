import { redirect } from "next/navigation";
import { getMember, homeFor } from "@/lib/auth";

export default async function Home() {
  const member = await getMember();
  redirect(member ? homeFor(member.role) : "/login");
}
