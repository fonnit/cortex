import { neon } from '@neondatabase/serverless';

export interface IdentityProfile {
  role: string;
  name: string;
  relationship?: string | null;
}

export interface IdentityContext {
  owner: string | null;
  knownPeople: { name: string; relationship: string }[];
  contextBlock: string;
}

export async function fetchIdentityContext(userId: string): Promise<IdentityContext> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT role, name, relationship
    FROM "IdentityProfile"
    WHERE user_id = ${userId}
    ORDER BY role DESC
  ` as IdentityProfile[];

  const ownerRow = rows.find((r) => r.role === 'owner');
  const owner = ownerRow?.name ?? null;
  const knownPeople = rows
    .filter((r) => r.role === 'known_person' && r.relationship)
    .map((r) => ({ name: r.name, relationship: r.relationship! }));

  const lines: string[] = [];
  if (owner) lines.push(`Archive owner: ${owner}`);
  if (knownPeople.length) {
    lines.push('Known people: ' + knownPeople.map((p) => `${p.name} (${p.relationship})`).join(', '));
  }

  return {
    owner,
    knownPeople,
    contextBlock: lines.length ? lines.join('\n') : '',
  };
}
