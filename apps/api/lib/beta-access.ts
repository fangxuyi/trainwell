import sql from "./db";

export function isBetaInviteRequired(): boolean {
  return process.env.BETA_INVITE_REQUIRED === "true";
}

export async function hasBetaAccess(userId: string): Promise<boolean> {
  if (!isBetaInviteRequired()) return true;

  const rows = await sql`
    SELECT 1 FROM beta_access_users
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export function isValidAdminSecret(secret: unknown): boolean {
  const configured = process.env.ADMIN_SECRET;
  return Boolean(configured) && typeof secret === "string" && secret === configured;
}
