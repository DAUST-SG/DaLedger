import { Link } from "react-router-dom";

/** Violet bar with a Back link, used on every screen except Home. */
export default function PageHeader(props: { title: string; back?: string }) {
  return (
    <header className="bg-brand text-white px-5 py-4 flex items-center gap-4 sticky top-[env(safe-area-inset-top,0px)] z-10 print:static">
      <Link to={props.back ?? "/"} className="text-white/80 font-medium">← Back</Link>
      <h1 className="font-semibold truncate">{props.title}</h1>
    </header>
  );
}
