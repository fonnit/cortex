import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  try {
    const profiles = await prisma.identityProfile.findMany({
      where: { user_id: userId },
      select: { id: true, name: true, type: true, email: true },
      orderBy: { created_at: 'asc' },
    })
    return Response.json(profiles)
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const { name, type, email } = body as Record<string, string | undefined>

  if (!name || name.trim() === '') {
    return new Response('Bad Request: name is required', { status: 400 })
  }
  if (!type || type.trim() === '') {
    return new Response('Bad Request: type is required', { status: 400 })
  }

  try {
    const profile = await prisma.identityProfile.create({
      data: {
        user_id: userId,
        name: name.trim(),
        type: type.trim(),
        email: email ?? null,
      },
    })
    return Response.json(profile, { status: 201 })
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }
}

export async function PUT(request: Request) {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const { id, name, type, email } = body as Record<string, string | undefined>

  if (!id) return new Response('Bad Request: id is required', { status: 400 })

  try {
    const profile = await prisma.identityProfile.update({
      where: { id, user_id: userId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(type !== undefined && { type: type.trim() }),
        ...(email !== undefined && { email: email || null }),
      },
    })
    return Response.json(profile)
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return new Response('Bad Request: id is required', { status: 400 })

  try {
    await prisma.identityProfile.delete({
      where: { id, user_id: userId },
    })
    return new Response(null, { status: 204 })
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }
}
