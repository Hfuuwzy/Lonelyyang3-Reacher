<template>
  <div data-testid="home-paper-transition" class="home-paper-transition" aria-hidden="true" />
</template>

<style scoped>
.home-paper-transition {
  position: relative;
  z-index: 1;
  isolation: isolate;
  inline-size: 100%;
  block-size: var(--home-paper-depth-desktop);
  margin-block-start: calc(var(--home-paper-diagonal) * -1);
  background: var(--paper);
  clip-path: polygon(0 var(--home-paper-diagonal), 36% 0, 100% calc(var(--home-paper-diagonal) * 0.55), 100% 100%, 0 100%);
  filter: drop-shadow(0 -2px 3px color-mix(in srgb, var(--rule) 24%, transparent));
  pointer-events: none;
}

.home-paper-transition::before {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--paper-warm) 42%, var(--paper));
  clip-path: polygon(
    0 var(--home-paper-diagonal),
    36% 0,
    100% calc(var(--home-paper-diagonal) * 0.55),
    100% calc(var(--home-paper-diagonal) * 0.69),
    36% calc(var(--home-paper-diagonal) * 0.14),
    0 calc(var(--home-paper-diagonal) * 1.14)
  );
  content: "";
}

@media (width < 1024px) {
  .home-paper-transition {
    block-size: var(--home-paper-depth-tablet);
  }
}

@media (width < 768px) {
  .home-paper-transition {
    block-size: var(--home-paper-depth-mobile);
  }
}
</style>
