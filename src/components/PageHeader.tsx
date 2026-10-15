import { Link } from "react-router-dom";

/** Violet bar with a Back link, used on every screen except Home. */
export default function PageHeader(props: { title: string; back?: string }) {
  return (
    <header className="bg-brand text-white px-5 py-4 flex items-center gap-4">
      <Link to={props.back ?? "/"} className="underline underline-offset-2 text-white/85">Back</Link>
      <h1 className="font-semibold truncate">{props.title}</h1>
    </header>
  );
}
