// A native popover opens in the middle of the window. This puts each `.info-pop` next to the button that opens it.
const GAP = 8;
const EDGE = 16;
const POPOVER_WIDTH = 280;
const FLIP_BELOW = 200;

function place(popover, button) {
  const rect = button.getBoundingClientRect();
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * EDGE);
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, EDGE), window.innerWidth - width - EDGE);
  const opensAbove = window.innerHeight - rect.bottom < FLIP_BELOW;

  popover.style.width = `${width}px`;
  popover.style.left = `${left}px`;
  popover.style.top = opensAbove ? 'auto' : `${rect.bottom + GAP}px`;
  popover.style.bottom = opensAbove ? `${window.innerHeight - rect.top + GAP}px` : 'auto';
}

export function mountInfoPopovers() {
  for (const popover of document.querySelectorAll('.info-pop')) {
    // More than one button can open the same popover, so it opens beside the one that was pressed last.
    const buttons = [...document.querySelectorAll(`[popovertarget="${popover.id}"]`)];
    let opener = buttons[0];

    for (const button of buttons) {
      button.addEventListener('click', () => {
        opener = button;
      });
    }

    popover.addEventListener('beforetoggle', (event) => {
      if (event.newState === 'open') {
        place(popover, opener);
        // The popover stays where it opened, so it would drift away from its button on scroll.
        window.addEventListener('scroll', () => popover.hidePopover(), { once: true, passive: true });
      }
    });
  }
}
