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
  }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
  $$('[data-reveal]').forEach((element) => observer.observe(element));
} else {
  $$('[data-reveal]').forEach((element) => element.classList.add('revealed'));
}

// The bridge photograph drifts slowly as the page scrolls.
const bridge = $('.bridge img');
const bridgeFrame = $('.bridge-frame');
if (!reducedMotion) {
  let queued = false;
  const drift = () => {
    queued = false;
    const box = bridgeFrame.getBoundingClientRect();
    const progress = (box.top + box.height) / (window.innerHeight + box.height);
    if (progress >= 0 && progress <= 1) {
      bridge.style.transform = `translateY(${(progress - 1) * 10.7}%)`;
    }
  };
  window.addEventListener('scroll', () => {
    if (!queued) { queued = true; requestAnimationFrame(drift); }
  }, { passive: true });
  drift();
}
