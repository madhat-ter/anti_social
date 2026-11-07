'use client';
import { useTitle } from '@/lib/hooks';
import { useEffect, useState } from 'react';
import { api, errorMessage, type MemberSummary, type Post } from '@/lib/api';
import { SeatedShell } from '@/components/Shell';
import { MemberRow } from '@/components/MemberRow';
import { PostCard, replaceIn } from '@/components/PostCard';
import { ErrorNote } from '@/components/ui';

export default function SearchPage() {
  useTitle('Search');
  return <SeatedShell>{() => <Search />}</SeatedShell>;
}

// Rendered only client-side (inside SeatedShell, after /me loads), so window is available.
const initialQuery = () => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q') ?? '');

function Search() {
  const [q, setQ] = useState(initialQuery);
  const [term, setTerm] = useState(() => initialQuery().trim());
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // debounce
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // sync URL
  useEffect(() => {
    const url = term ? `/search?q=${encodeURIComponent(term)}` : '/search';
    window.history.replaceState(window.history.state, '', url);
  }, [term]);

  useEffect(() => {
    if (!term) { setMembers([]); setPosts([]); setError(null); setLoading(false); return; }
    let alive = true;
    setLoading(true); setError(null);
    api.search(term).then(
      (r) => { if (alive) { setMembers(r.members); setPosts(r.posts); setLoading(false); } },
      (e) => { if (alive) { setError(errorMessage(e)); setMembers([]); setPosts([]); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [term]);

  const searched = term !== '' && !loading && !error;
  return (
    <>
      <h1>Search</h1>
      <form role="search" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <label>
          <span className="sr-only">Search members and posts</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members and posts" autoFocus autoComplete="off" />
        </label>
      </form>
      {!term && <p className="muted">Type to search members and posts.</p>}
      {loading && <p className="muted" role="status">Searching...</p>}
      <ErrorNote message={error} />
      {searched && (
        <>
          <section aria-labelledby="s-m" className="stack">
            <h2 id="s-m" className="section-h">Members</h2>
            {members.length === 0 ? <p className="muted">No members found.</p> : (
              <ul className="members card">{members.map((m) => <MemberRow key={m.handle} m={m} />)}</ul>
            )}
          </section>
          <section aria-labelledby="s-p" className="stack">
            <h2 id="s-p" className="section-h">Posts</h2>
            {posts.length === 0 ? <p className="muted">No posts found.</p> : (
              <div className="posts">
                {posts.map((p) => <PostCard key={p.id} post={p} onChange={(np) => setPosts((cur) => replaceIn(cur, np))} />)}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
