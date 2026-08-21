import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/data/membership";
import { RoleProvider } from "@/lib/role-context";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getMembership();

  return (
    <RoleProvider membership={membership}>
      <AppShell>{children}</AppShell>
    </RoleProvider>
  );
}
