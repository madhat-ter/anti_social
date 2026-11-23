import { ABOUT_LINES, FAQ } from '@/lib/about';

/**
 * RFC §10.29: under the landing page's message and seats, what anti is and five short answers, in
 * plain words. The owner's message above stays exactly as it is (§10.25); this only explains.
 * The same words go into the structured data (HomeJsonLd), so they must stay visible here.
 */
export function About() {
  return (
    <section className="about" aria-labelledby="about-h">
      <h2 id="about-h" className="about-h">What is anti?</h2>
      <div className="about-lead">
        {ABOUT_LINES.map((l) => <p key={l}>{l}</p>)}
      </div>
      <h2 className="about-h">Questions</h2>
      <div className="faq">
        {FAQ.map(({ q, a }) => (
          <div key={q} className="faq-item">
            <h3>{q}</h3>
            <p>{a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
