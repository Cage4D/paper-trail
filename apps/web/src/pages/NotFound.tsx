import { Link } from 'react-router';
import envelope from '../assets/stickers/sealed-envelope.svg';
import { AppPage } from '../components/Shell';

export function NotFound() {
  return (
    <AppPage>
      <section className="pt-wrap pt-section pt-empty">
        <img src={envelope} alt="" aria-hidden="true" className="pt-empty__art" />
        <h1 className="pt-h1">Nothing filed here</h1>
        <p className="pt-lead">That page doesn't exist. The paper trail starts on the home page.</p>
        <Link className="pt-btn pt-btn--primary" to="/">
          Go to the home page
        </Link>
      </section>
    </AppPage>
  );
}
