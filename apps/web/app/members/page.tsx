'use client';
import { api, type MemberSummary } from '@/lib/api';
import { usePaged } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ListStatus, PagedFooter } from '@/components/Paged';
import { MemberRow } from '@/components/MemberRow';

export default function MembersPage() {
  return <SeatedShell>{() => <Members />}</SeatedShell>;
}

function Members() {
  const p = usePaged<MemberSummary>('members', (c) => api.members(c));
  return (
    <>
      <h1>Members</h1>
      <ListStatus p={p} count={p.items.length} empty="No members yet." />
      {p.items.length > 0 && (
        <ul className="members card">
          {p.items.map((m) => <MemberRow key={m.handle} m={m} />)}
        </ul>
      )}
      <PagedFooter p={p} />
    </>
  );
}
