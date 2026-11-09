'use client';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { PetsIndex } from '@/components/Pets';

export default function PetsPage() {
  useTitle('Pet Corner');
  return <SeatedShell>{() => <PetsIndex />}</SeatedShell>;
}
