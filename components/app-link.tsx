"use client";

import NextLink, { type LinkProps } from "next/link";
import {
  forwardRef,
  type AnchorHTMLAttributes,
} from "react";

type AppLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>;

/**
 * Vinext beta currently throws while preparing automatic RSC prefetches on
 * the Cloudflare runtime. Navigation itself is reliable, so keep prefetch
 * disabled in one place until the runtime implementation is upgraded.
 */
const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(
  props,
  ref,
) {
  return <NextLink {...props} prefetch={false} ref={ref} />;
});

export default AppLink;
