import { headers } from "next/headers";
import { auth } from "./auth";
import { one, type Database } from "./db";

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  x_handle: string | null;
  discord_handle: string | null;
  joined_at: Date;
  suspended: boolean;
  removed: boolean;
};
export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
export async function session(requestHeaders?: Headers) {
  return auth.api.getSession({ headers: requestHeaders ?? (await headers()) });
}
export function profileFor(userId: string, db?: Database) {
  return one<Profile>("SELECT * FROM profiles WHERE auth_user_id=$1", [userId], db);
}
export function isAdmin(user: Session["user"]) {
  return (
    user.emailVerified &&
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
      .includes(user.email.toLowerCase())
  );
}
