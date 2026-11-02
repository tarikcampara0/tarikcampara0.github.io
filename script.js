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

// The live thing: replays deployments recorded from the real DeployOps pipeline.
// [step, message, isError], copied from GET /api/v1/deployments/{id}/logs.
const STEPS = ['preflight', 'provision_database', 'apply_migrations', 'configure_tenant', 'verify'];
const RUNS = {
  good: {
    title: 'Northline Freight production, 1.1.0 to 1.2.0',
    outcome: 'Every check passed, so Northline Freight is live on 1.2.0.',
    failedAt: null,
    lines: [
      ['preflight', 'Rolling out 1.2.0: Adds orders and an index for reporting'],
      ['preflight', 'Running version: 1.1.0'],
      ['preflight', 'Provider ready: SQLite files on local disk'],
      ['provision_database', 'Database already exists'],
      ['apply_migrations', 'Applying 0003_orders.sql'],
      ['apply_migrations', 'Committed 1 migration(s) in one transaction'],
      ['configure_tenant', 'Wrote 3 settings for Northline Freight'],
      ['verify', 'connectivity: Accepted a connection and answered a query'],
      ['verify', 'schema_version: All 3 migrations of 1.2.0 are recorded'],
      ['verify', "schema_drift: Recorded checksums match the release's files"],
      ['verify', 'required_tables: Found all 4 required tables'],
      ['verify', 'write_read: Wrote and read back a row inside a rolled-back transaction'],
      ['', 'Northline Freight production is live on 1.2.0'],
    ],
  },
  broken: {
    title: 'Harbor Clinic Group production, 1.2.0 to 1.3.0-broken',
    outcome: "The release's second migration failed, so its first was undone too. Harbor Clinic Group stays on 1.2.0.",
    failedAt: 'apply_migrations',
    lines: [
      ['preflight', 'Rolling out 1.3.0-broken: Demo: its second migration fails, so the whole release rolls back'],
      ['preflight', 'Running version: 1.2.0'],
      ['preflight', 'Provider ready: SQLite files on local disk'],
      ['provision_database', 'Database already exists'],
      ['apply_migrations', 'Applying 0004_invoices.sql'],
      ['apply_migrations', 'Applying 0005_broken.sql'],
      ['apply_migrations', 'migration_failed: no such table: invoice_lines', true],
    ],
  },
};

const runnerSteps = [...$('#runnerSteps').children];
const runnerLog = $('#runnerLog');
const runnerOutcome = $('#runnerOutcome');
const runnerTitle = $('#runnerTitle');
const runButtons = $$('[data-run]');
let timer = null;

function paintSteps(run, count) {
  // Works out each step's state from the log lines shown so far.
  const shown = run.lines.slice(0, count);
  const current = shown.length ? shown[shown.length - 1][0] : STEPS[0];
  const finished = count === run.lines.length;
  const reached = current === '' ? STEPS.length : STEPS.indexOf(current);
  runnerSteps.forEach((element, index) => {
    let state = 'is-pending';
    if (index < reached) state = 'is-succeeded';
    if (index === reached) {
      if (finished && STEPS[index] === run.failedAt) state = 'is-failed';
      else state = 'is-running';
    }
    if (finished && run.failedAt && index > reached) state = 'is-skipped';
    element.className = state;
  });
}

function addLine([step, message, isError]) {
  const text = `${step.padEnd(18)} ${message}\n`;
  const code = runnerLog.querySelector('code');
  if (isError) {
    const span = document.createElement('span');
    span.className = 'is-error';
    span.textContent = text;
    code.append(span);
  } else {
    code.append(text);
  }
  runnerLog.scrollTop = runnerLog.scrollHeight;
}

function startRun(name) {
  const run = RUNS[name];
  clearInterval(timer);
  runButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.run === name)));
  runnerTitle.textContent = run.title;
  runnerOutcome.textContent = 'Running…';
  runnerLog.querySelector('code').textContent = '';

  if (reducedMotion) {
    run.lines.forEach(addLine);
    paintSteps(run, run.lines.length);
    runnerOutcome.textContent = run.outcome;
    return;
  }

  let shown = 0;
  paintSteps(run, 0);
  timer = setInterval(() => {
    addLine(run.lines[shown]);
    shown += 1;
    paintSteps(run, shown);
    if (shown === run.lines.length) {
      clearInterval(timer);
      runnerOutcome.textContent = run.outcome;
    }
  }, 420);
}

runButtons.forEach((button) => button.addEventListener('click', () => startRun(button.dataset.run)));
