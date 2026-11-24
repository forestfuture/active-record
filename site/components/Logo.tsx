// The Arbor logo: small beside the site's name in the header, and on the home page in place
// of the animated orb (orb.ts) for readers who ask for reduced motion or where it can't draw. The
// mark is public/icon.svg, which Blume also uses as the favicon (by its name) and
// blume.config.ts's `logo` shows in the 404 page's header; replace that file to change it
// everywhere.
import mark from "../public/icon.svg?raw";

const sizes = { sm: 20, lg: 40 } as const;

export default function Logo({ size }: { size: keyof typeof sizes }) {
  const pixels = sizes[size];
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 [&>svg]:size-full"
      style={{ width: pixels, height: pixels }}
      dangerouslySetInnerHTML={{ __html: mark }}
    />
  );
}
