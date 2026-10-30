import { Link } from "react-router-dom";

/**
 * Phones: violet bar with a Back link. Laptops: the sidebar handles navigation,
 * so the page just opens with its title.
 */
export default function PageHeader(props: { title: string; back?: string }) {
  return (
    <>
      <header className="lg:hidden bg-brand text-white px-5 py-4 flex items-center gap-4 sticky top-[env(safe-area-inset-top,0px)] z-10 print:static">
        <Link to={props.back ?? "/"} className="text-white/80 font-medium">← Back</Link>
        <h1 className="font-semibold truncate">{props.title}</h1>
      </header>
      <header className="hidden lg:flex items-baseline gap-4 px-8 pt-9 pb-1 max-w-5xl">
        {props.back && props.back !== "/" && <Link to={props.back} className="text-sm text-muted hover:text-ink">← Back</Link>}
        <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
      </header>
    </>
  );
}
