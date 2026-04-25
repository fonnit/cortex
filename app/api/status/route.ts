import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)

  const [lastItem, lastGmailItem, gmailCursor, statusCounts] = await Promise.all([
    prisma.item.findFirst({
      where: { user_id: userId },
      orderBy: { ingested_at: 'desc' },
      select: { ingested_at: true },
    }),
    prisma.item.findFirst({
      where: { user_id: userId, source: 'gmail' },
      orderBy: { ingested_at: 'desc' },
      select: { ingested_at: true },
    }),
    prisma.gmailCursor.findUnique({
      where: { user_id: userId },
      select: { last_successful_poll_at: true, last_history_id: true },
    }),
    prisma.item.groupBy({
      by: ['status'],
      where: { user_id: userId },
      _count: true,
    }),
  ])

  const daemonLastSeen = lastItem?.ingested_at ?? null
  const daemonConnected = daemonLastSeen ? daemonLastSeen > tenMinAgo : false

  const gmailLastActivity = gmailCursor?.last_successful_poll_at ?? lastGmailItem?.ingested_at ?? null
  const gmailSyncing = gmailCursor && !gmailCursor.last_successful_poll_at && lastGmailItem
  const gmailConnected = gmailLastActivity ? gmailLastActivity > tenMinAgo : false

  const counts: Record<string, number> = {}
  for (const row of statusCounts) {
    counts[row.status] = row._count
  }

  function formatAgo(date: Date | null): string {
    if (!date) return '—'
    const sec = Math.floor((Date.now() - date.getTime()) / 1000)
    if (sec < 60) return `${sec}s ago`
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
    return `${Math.floor(sec / 86400)}d ago`
  }

  return Response.json({
    daemon: {
      connected: daemonConnected,
      lastSeen: formatAgo(daemonLastSeen),
    },
    gmail: {
      connected: gmailSyncing ? true : gmailConnected,
      lastSync: gmailSyncing ? 'syncing…' : formatAgo(gmailLastActivity),
    },
    counts: {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      ignored: counts.ignored ?? 0,
      uncertain: counts.uncertain ?? 0,
      certain: counts.certain ?? 0,
      processing: counts.processing ?? 0,
    },
  })
}
