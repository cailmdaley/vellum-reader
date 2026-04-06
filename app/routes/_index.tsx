import { redirect } from '@remix-run/node';
import type { LoaderFunction } from '@remix-run/node';

// Redirect root to the constitution fiber — the entry point for Vellum dogfooding.
// TODO: make this configurable (root narrative fiber per project).
export const loader: LoaderFunction = async () => {
  return redirect('/vellum-reader');
};

export default function Index() {
  return null;
}
