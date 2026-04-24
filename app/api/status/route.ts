import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)

  const [lastItem, gmailCursor] = await Promise.all([
    prisma.item.findFirst({
      where: { user_id: userId },
      orderBy: { ingested_at: 'desc' },
      select: { ingested_at: true },
    }),
    prisma.gmailCursor.findUnique({
      where: { user_id: userId },
      select: { last_successful_poll_at: true },
    }),
  ])

  const daemonLastSeen = lastItem?.ingested_at ?? null
  const daemonConnected = daemonLastSeen ? daemonLastSeen > tenMinAgo : false

  const gmailLastSync = gmailCursor?.last_successful_poll_at ?? null
  const gmailConnected = gmailLastSync ? gmailLastSync > tenMinAgo : false

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
      connected: gmailConnected,
      lastSync: formatAgo(gmailLastSync),
    },
  })
}
