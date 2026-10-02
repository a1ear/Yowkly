import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { Messenger } from '@/components/messenger';

export const metadata: Metadata = { title: 'Messages', robots: { index: false } };

export default async function MessagesPage(props: PageProps<'/messages'>) {
  const sp = await props.searchParams;
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) redirect('/auth/sign-in?next=/messages');
  const c = typeof sp.c === 'string' && /^[0-9a-f-]{36}$/.test(sp.c) ? sp.c : null;
  return <Messenger me={uid} initial={c} initialTab={sp.tab === 'requests' ? 'requests' : 'chats'} />;
}
