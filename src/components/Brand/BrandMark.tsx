import React from 'react';

/**
 * MarkDaun symbol: a faceted leaf whose central nerve is the Markdown ↓ arrow and whose
 * side nerves end in gold nodes (design/icons/mark.svg, with slightly thicker cuts for
 * small sizes). Cut-outs are real holes in the path, so it sits on any background.
 * Brand colours only: the leaf is --logo (Navy on light, Oro on dark), the nodes --gold.
 */
const LEAF =
  'M324 330 L254 520 L364 730 L512 864 L660 730 L770 520 L700 330 L512 160Z M692 374 L692 380 L692 386 L691 391 L689 397 L686 402 L683 407 L679 411 L675 415 L670 418 L665 421 L659 423 L654 424 L648 424 L642 424 L637 423 L631 421 L626 418 L625 417 L540 473 L540 648 L584 604 L624 644 L604 664 L512 756 L400 644 L440 604 L460 624 L484 648 L484 563 L399 507 L398 508 L393 511 L387 513 L382 514 L376 514 L370 514 L365 513 L359 511 L354 508 L349 505 L345 501 L341 497 L338 492 L335 487 L333 481 L332 476 L332 470 L332 464 L333 459 L335 453 L338 448 L341 443 L345 439 L349 435 L354 432 L359 429 L365 427 L370 426 L376 426 L382 426 L387 427 L393 429 L398 432 L403 435 L407 439 L411 443 L414 448 L417 453 L419 459 L420 464 L420 470 L420 476 L419 477 L484 520 L484 232 L540 232 L540 260 L540 430 L605 387 L604 386 L604 380 L604 374 L605 369 L607 363 L610 358 L613 353 L617 349 L621 345 L626 342 L631 339 L637 337 L642 336 L648 336 L654 336 L659 337 L665 339 L670 342 L675 345 L679 349 L683 353 L686 358 L689 363 L691 369Z';

export function BrandMark({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <svg
      data-testid="brand-mark"
      aria-hidden="true"
      width={(size * 576) / 744}
      height={size}
      viewBox="224 140 576 744"
    >
      <path fill="var(--logo)" fillRule="evenodd" d={LEAF} />
      <circle cx="648" cy="380" r="26" fill="var(--gold)" />
      <circle cx="376" cy="470" r="26" fill="var(--gold)" />
    </svg>
  );
}
