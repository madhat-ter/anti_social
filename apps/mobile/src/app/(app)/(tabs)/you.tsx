/** "You": straight to your own profile, its drawers on top (RFC §10.26). */
import { useMe } from '@/lib/session';
import { Profile } from '@/components/Profile';

export default function YouScreen() {
  const me = useMe();
  return <Profile handle={me.handle} own />;
}
