import { Link } from "react-router";
import { PageIntro } from "../components/PageIntro";
export function NotFoundPage() {
  return (
    <>
      <PageIntro
        eyebrow="404"
        title="Bu sayfayı bulamadık."
        description="Ana sayfaya dönerek devam edebilirsin."
      />
      <Link to="/" className="button primary">
        Ana sayfaya dön
      </Link>
    </>
  );
}
