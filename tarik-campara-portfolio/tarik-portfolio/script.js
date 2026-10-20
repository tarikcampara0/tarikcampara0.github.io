/* PERSONALIZE THESE LINKS BEFORE PUBLISHING.
   Leave a value empty to show a helpful setup hint when clicked. */
const CONTACT = {
  email: '',                // example: 'tarikcampara04'
  linkedin: '',             // example: 'https://www.linkedin.com/in/tarikcampara'
  github: ''                // example: 'https://github.com/tarikcampara0'
};

const $ = (selector) => document.querySelector(selector);
const menuButton = $('#menuToggle');
const nav = $('#navLinks');

function closeMenu() {
  nav.classList.remove('is-open');
  menuButton.classList.remove('is-open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
}

menuButton?.addEventListener('click', () => {
  const willOpen = !nav.classList.contains('is-open');
  nav.classList.toggle('is-open', willOpen);
  menuButton.classList.toggle('is-open', willOpen);
  menuButton.setAttribute('aria-expanded', String(willOpen));
  menuButton.setAttribute('aria-label', willOpen ? 'Close navigation' : 'Open navigation');
});

nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
document.addEventListener('click', e => {
  if (nav?.classList.contains('is-open') && !nav.contains(e.target) && !menuButton.contains(e.target)) closeMenu();
});

const toast = $('#toast');
let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}
function openContact(type) {
  if (!CONTACT[type]) {
    showToast(`Add your ${type === 'email' ? 'email address' : type + ' URL'} in script.js to enable this link.`);
    return;
  }
  if (type === 'email') {
    window.location.href = 'mailto:' + CONTACT.email;
  } else {
    const url = CONTACT[type];
    if (!/^https:\/\//i.test(url)) { showToast('Use a full https:// URL in script.js.'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
$('#emailButton')?.addEventListener('click', () => openContact('email'));
$('#linkedinButton')?.addEventListener('click', () => openContact('linkedin'));
$('#githubButton')?.addEventListener('click', () => openContact('github'));

const year = $('#year');
if (year) year.textContent = new Date().getFullYear();

// Entrance animation; gracefully displays content without JS or observer support.
const motionDisabled = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!motionDisabled && 'IntersectionObserver' in window) document.body.classList.add('motion-ready');
if ('IntersectionObserver' in window && !motionDisabled) {
  const sections = document.querySelectorAll('[data-reveal]');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.09, rootMargin: '0px 0px -24px 0px' });
  sections.forEach(el => {
    const delay = Number(el.dataset.delay) || 0;
    el.style.setProperty('--reveal-delay', `${delay}ms`);
    observer.observe(el);
  });
} else {
  document.querySelectorAll('[data-reveal]').forEach(el => el.classList.add('revealed'));
}

const header = $('.site-header');
function updateHeader() { header?.classList.toggle('scrolled', window.scrollY > 16); }
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });
