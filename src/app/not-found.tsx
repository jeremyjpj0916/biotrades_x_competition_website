import Link from "next/link";
import { PageHeading } from "@/components/ui";
export default function NotFound() {
  return (
    <div className="page">
      <PageHeading
        tag="404"
        title="Page not found"
        description="This competition page, security, or profile could not be found."
      />
      <Link className="button primary" href="/">
        Back to overview
      </Link>
    </div>
  );
}
