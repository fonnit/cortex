import { neon } from '@neondatabase/serverless';

export interface IdentityProfile {
  name: string;
  type: string;
}

export interface IdentityContext {
  contextBlock: string; // "Daniel Fonnegra (owner), Acme Corp (company), Maria (partner)"
  identities: { name: string; type: string }[];
}

export async function fetchIdentityContext(userId: string): Promise<IdentityContext> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT name, type FROM "IdentityProfile"
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  ` as IdentityProfile[];

  const contextBlock = rows.length
    ? rows.map(r => `${r.name} (${r.type})`).join(', ')
    : '';

  return { contextBlock, identities: rows };
}
