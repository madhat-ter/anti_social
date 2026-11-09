'use client';
import { useParams } from 'next/navigation';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { PetPage } from '@/components/Pets';

export default function PetOnePage() {
  const params = useParams<{ id: string }>();
  useTitle('Pet');
  return <SeatedShell>{(me) => <PetPage id={decodeURIComponent(params.id)} me={me} />}</SeatedShell>;
}
