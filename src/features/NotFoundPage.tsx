import { Link } from 'react-router-dom';
import { PageHead } from '../components/ui';

export function NotFoundPage() {
  return (
    <>
      <PageHead eyebrow="Not found" title="Page not found" description="This page does not exist or is not available to you." />
      <Link className="btn" to="/">Return to Overview</Link>
    </>
  );
}
