const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Mobile menu
const menuButton = $('#menuToggle');
const nav = $('#navLinks');

function setMenu(open) {
  nav.classList.toggle('is-open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.textContent = open ? 'Close' : 'Menu';
}

menuButton.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setMenu(false); });
document.addEventListener('click', (event) => {
  if (!nav.contains(event.target) && !menuButton.contains(event.target)) setMenu(false);
});

// Each part of a section rises once as it enters the screen.
if ('IntersectionObserver' in window && !reducedMotion) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px 15% 0px' }); // starts just before it scrolls into view, so a fast scroll never lands on a blank area
  $$('[data-reveal]').forEach((element) => observer.observe(element));
} else {
  $$('[data-reveal]').forEach((element) => element.classList.add('revealed'));
}
