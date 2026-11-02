// A small copy of DeployOps that runs entirely in the visitor's browser.
//
// It follows the real project's pipeline (backend/deployops/pipeline/engine.py), with
// the same five steps, SQL migrations, checks and failure reports. Each environment is
// a real SQLite database, so a failed release truly rolls back. Nothing is sent
// anywhere, and a refresh starts over.
(() => {
  const root = document.querySelector('#miniDeployOps');
  if (!root) return;

  const LINE_PACE_MS = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260;
  const MAX_CUSTOMERS = 8;
  const STEP_NAMES = ['preflight', 'provision_database', 'apply_migrations', 'configure_tenant', 'verify'];
  const STEP_LABELS = {
    preflight: 'Preflight',
    provision_database: 'Provision database',
    apply_migrations: 'Apply migrations',
    configure_tenant: 'Configure tenant',
    verify: 'Verify',
  };

  const MIGRATIONS = {
    '0001_core.sql': `CREATE TABLE accounts (id INTEGER PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE, display_name VARCHAR(120) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE app_settings (key VARCHAR(80) PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
    '0002_audit_log.sql': `CREATE TABLE audit_log (id INTEGER PRIMARY KEY, account_id INTEGER REFERENCES accounts (id), action VARCHAR(80) NOT NULL, recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX ix_audit_log_account ON audit_log (account_id);`,
    '0003_orders.sql': `CREATE TABLE orders (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts (id), total_cents INTEGER NOT NULL CHECK (total_cents >= 0), status VARCHAR(20) NOT NULL DEFAULT 'open', placed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX ix_orders_status_placed ON orders (status, placed_at);`,
    '0004_invoices.sql': `CREATE TABLE invoices (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders (id), issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
    // Deliberately broken: invoice_lines was never created.
    '0005_broken.sql': `ALTER TABLE invoice_lines ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0;`,
  };

  const CORE = ['0001_core.sql'];
  const AUDIT = [...CORE, '0002_audit_log.sql'];
  const ORDERS = [...AUDIT, '0003_orders.sql'];
  const RELEASES = [
    { version: '1.0.0', notes: 'Accounts and settings', migrations: CORE, tables: ['accounts', 'app_settings'] },
    { version: '1.1.0', notes: 'Adds the audit log', migrations: AUDIT, tables: ['accounts', 'app_settings', 'audit_log'] },
    { version: '1.2.0', notes: 'Adds orders and an index for reporting', migrations: ORDERS, tables: ['accounts', 'app_settings', 'audit_log', 'orders'] },
    { version: '1.3.0-broken', notes: 'Has a deliberate bug, to show a failed rollout', migrations: [...ORDERS, '0004_invoices.sql', '0005_broken.sql'], tables: ['accounts', 'app_settings', 'audit_log', 'orders', 'invoices'] },
  ];
  const releaseOf = (version) => RELEASES.find((release) => release.version === version);
  const versionKey = (version) => version.split('-')[0].split('.').map(Number);
  const isOlder = (a, b) => {
    const [x, y] = [versionKey(a), versionKey(b)];
    for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
  };

  class PreflightError extends Error {}
  class DriftError extends Error {}
  class VerificationError extends Error {}
  class OfflineError extends Error {}

  // Turns exceptions into a report for whoever is on the call with the customer.
  function classify(error, step) {
    if (error instanceof PreflightError) return { category: 'preflight', hint: 'Nothing was changed. Correct the request and deploy again.' };
    if (error instanceof DriftError) return { category: 'schema_drift', hint: 'A migration was edited after being applied. Restore the original file and ship the change as a new migration. Do not retry until the files match.' };
    if (error instanceof VerificationError) return { category: 'verification_failed', hint: 'The release applied but the environment failed its checks. Compare the failed checks with the customer’s environment before going live.' };
    if (error instanceof OfflineError) return { category: 'database_unreachable', hint: 'The customer database could not be reached. Confirm it is running, then retry. Retrying is safe: finished work is reused.' };
    if (step === 'apply_migrations') return { category: 'migration_failed', hint: 'The release’s SQL failed and the whole release was rolled back, so the database is unchanged. The release needs a fix: retrying it as it is will fail the same way.' };
    return { category: 'unexpected', hint: 'This wasn’t an expected failure. Read the log, then retry.' };
  }

  // State ----------------------------------------------------------------------

  let SQL;
  let environments = [];
  let selected = null;
  let checksums = {};
  let generation = 0; // bumped by "Start over", so a run in progress stops touching the screen

  const sleep = (ms) => (ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
  const sentence = (text) => {
    const spaced = text.replace(/_/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  };
  const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  async function sha256(text) {
    if (!window.crypto?.subtle) return String([...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) | 0, 7));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function newEnvironment(customer, name) {
    return {
      id: `${slugify(customer)}/${name}`,
      customer,
      name,
      status: 'new',
      version: null,
      db: null,
      offline: false,
      busy: false,
      history: [],
      viewing: null,
      checks: [],
      note: '',
    };
  }

  // Customer database helpers --------------------------------------------------

  function connect(env) {
    if (env.offline) throw new OfflineError('connection to the customer database was refused');
    return env.db;
  }

  function tableNames(db) {
    const result = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'");
    return result.length ? result[0].values.map((row) => row[0]) : [];
  }

  function appliedMigrations(db) {
    if (!tableNames(db).includes('schema_migrations')) return {};
    const result = db.exec('SELECT name, checksum FROM schema_migrations');
    return result.length ? Object.fromEntries(result[0].values) : {};
  }

  function findDrift(release, applied) {
    return release.migrations.filter((name) => name in applied && applied[name] !== checksums[name]);
  }

  // Validation checks ----------------------------------------------------------

  const CHECKS = [
    ['connectivity', (db) => {
      db.exec('SELECT 1');
      return 'Accepted a connection and answered a query';
    }],
    ['schema_version', (db, release) => {
      const applied = appliedMigrations(db);
      const missing = release.migrations.filter((name) => !(name in applied));
      if (missing.length) throw new Error(`Expected ${release.version}, missing ${missing.join(', ')}`);
      return `All ${release.migrations.length} migrations of ${release.version} are recorded`;
    }],
    ['schema_drift', (db, release) => {
      const drifted = findDrift(release, appliedMigrations(db));
      if (drifted.length) throw new Error(`Checksums no longer match for ${drifted.join(', ')}`);
      return 'Recorded checksums match the release’s files';
    }],
    ['required_tables', (db, release) => {
      const tables = tableNames(db);
      const missing = release.tables.filter((table) => !tables.includes(table));
      if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}`);
      return `Found all ${release.tables.length} required tables`;
    }],
    ['write_read', (db) => {
      db.run('SAVEPOINT probe');
      try {
        db.run("INSERT INTO app_settings (key, value) VALUES ('__probe__', 'ok')");
        const result = db.exec("SELECT value FROM app_settings WHERE key = '__probe__'");
        if (result[0]?.values[0][0] !== 'ok') throw new Error('Wrote a row but could not read it back');
      } finally {
        db.run('ROLLBACK TO probe');
        db.run('RELEASE probe');
      }
      return 'Wrote and read back a row inside a rolled-back transaction';
    }],
  ];

  function runChecks(env, release) {
    env.checks = CHECKS.map(([name, check]) => {
      const started = performance.now();
      let passed = true;
      let detail;
      try {
        detail = check(connect(env), release);
      } catch (error) {
        passed = false;
        detail = error.message;
      }
      return { name, passed, detail, ms: Math.max(Math.round(performance.now() - started), 0) };
    });
    return env.checks;
  }

  // The pipeline ---------------------------------------------------------------

  const STEPS = {
    async preflight(ctx) {
      const { env, release } = ctx;
      if (env.version && isOlder(release.version, env.version)) {
        throw new PreflightError(`${release.version} is older than the running ${env.version}. Migrations only go forward, so ship a new release to undo a change.`);
      }
      await ctx.log(`Rolling out ${release.version}: ${release.notes}`);
      await ctx.log(`Running version: ${env.version || 'none, first deployment'}`);
      await ctx.log('Provider ready: SQLite in your browser');
    },

    async provision_database(ctx) {
      const { env } = ctx;
      if (env.db) {
        connect(env);
        await ctx.log('Database already exists');
      } else {
        env.db = new SQL.Database();
        await ctx.log('Created database and credentials');
      }
    },

    async apply_migrations(ctx) {
      const { env, release } = ctx;
      const db = connect(env);
      const applied = appliedMigrations(db);
      const drifted = findDrift(release, applied);
      if (drifted.length) throw new DriftError(`Applied migrations changed on disk: ${drifted.join(', ')}`);
      const pending = release.migrations.filter((name) => !(name in applied));
      if (!pending.length) {
        await ctx.log('Schema is already up to date');
        return;
      }
      // All or nothing: one transaction for every pending migration.
      db.run('BEGIN');
      try {
        db.run('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(200) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, release_version VARCHAR(40) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
        for (const name of pending) {
          await ctx.log(`Applying ${name}`);
          db.run(MIGRATIONS[name]);
          db.run('INSERT INTO schema_migrations (name, checksum, release_version) VALUES (?, ?, ?)', [name, checksums[name], release.version]);
        }
        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
      await ctx.log(`Committed ${pending.length} migration(s) in one transaction`);
    },

    async configure_tenant(ctx) {
      const { env, release } = ctx;
      const db = connect(env);
      const settings = { customer_name: env.customer, environment: env.name, release: release.version };
      db.run('BEGIN');
      try {
        for (const [key, value] of Object.entries(settings)) {
          db.run('DELETE FROM app_settings WHERE key = ?', [key]);
          db.run('INSERT INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
        }
        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
      await ctx.log(`Wrote 3 settings for ${env.customer}`);
    },

    async verify(ctx) {
      const results = runChecks(ctx.env, ctx.release);
      for (const result of results) {
        await ctx.log(`${result.name}: ${result.detail}`, result.passed ? 'info' : 'error');
      }
      const failed = results.filter((result) => !result.passed).map((result) => result.name);
      if (failed.length) throw new VerificationError(`Failed checks: ${failed.join(', ')}`);
    },
  };

  async function deploy(env, version, { pace = LINE_PACE_MS, retryOf = null } = {}) {
    if (env.busy) return;
    const startedIn = generation;
    const release = releaseOf(version);
    const run = {
      version,
      from: env.version,
      status: 'running',
      retryOf,
      failure: null,
      logs: [],
      steps: STEP_NAMES.map((name) => ({ name, status: 'pending', ms: null })),
    };
    const statusBefore = env.status;
    env.history.unshift(run);
    env.viewing = run;
    env.busy = true;
    env.status = 'deploying';
    env.note = '';
    render();

    const ctx = {
      env,
      release,
      step: '',
      async log(message, level = 'info') {
        run.logs.push({ step: ctx.step, message, level });
        if (selected === env) renderLog();
        await sleep(pace);
      },
    };

    for (const step of run.steps) {
      ctx.step = step.name;
      step.status = 'running';
      renderPipeline();
      const started = performance.now();
      try {
        await STEPS[step.name](ctx);
        step.status = 'succeeded';
        step.ms = Math.round(performance.now() - started);
      } catch (error) {
        const report = classify(error, step.name);
        step.status = 'failed';
        step.ms = Math.round(performance.now() - started);
        run.steps.filter((later) => later.status === 'pending').forEach((later) => { later.status = 'skipped'; });
        run.status = 'failed';
        run.failure = { category: report.category, summary: error.message, hint: report.hint };
        // A refused request changed nothing, so the environment is as healthy as it was.
        if (error instanceof PreflightError) env.status = statusBefore;
        else env.status = env.version ? 'degraded' : 'failed';
        env.busy = false;
        await ctx.log(`${report.category}: ${error.message}`, 'error');
        if (startedIn === generation) render();
        return;
      }
      renderPipeline();
    }

    ctx.step = '';
    run.status = 'succeeded';
    env.version = version;
    env.status = 'healthy';
    env.busy = false;
    await ctx.log(`${env.customer} ${env.name} is live on ${version}`);
    if (startedIn === generation) render();
  }

  // The screen -----------------------------------------------------------------

  const TEMPLATE = `
    <div class="mini-side" data-ui>
      <div class="mini-brand"><img src="assets/deployops-mark.svg" alt="" width="24" height="24" /> DeployOps</div>
      <ul class="mini-list" data-ref="list"></ul>
      <form class="mini-form" data-ref="form" novalidate>
        <label>New customer <input data-ref="name" maxlength="40" autocomplete="off" placeholder="Company name" /></label>
        <label>Environment
          <select data-ref="envName"><option>production</option><option>staging</option></select>
        </label>
        <p class="mini-problem" data-ref="formProblem" role="alert" hidden></p>
        <button type="submit" class="mini-button">Onboard customer</button>
      </form>
      <button type="button" class="mini-text" data-ref="reset">Start over</button>
    </div>
    <div class="mini-main" data-ui>
      <div class="mini-head">
        <div>
          <div class="mini-title" role="heading" aria-level="4" data-ref="title"></div>
          <p class="mini-muted" data-ref="running"></p>
        </div>
        <span class="mini-pill" data-ref="status"></span>
      </div>

      <div class="mini-controls">
        <label class="mini-release">Release <select data-ref="release"></select></label>
        <button type="button" class="mini-button mini-primary" data-ref="deploy">Deploy</button>
        <button type="button" class="mini-button" data-ref="runChecks">Run checks</button>
      </div>

      <section class="mini-failure" data-ref="failure" aria-label="Failure report" hidden>
        <strong data-ref="failureCategory"></strong>
        <code data-ref="failureSummary"></code>
        <p data-ref="failureHint"></p>
        <button type="button" class="mini-button" data-ref="retry">Retry deployment</button>
      </section>

      <ol class="console-steps" data-ref="steps" aria-label="Pipeline steps"></ol>
      <pre class="console-log" data-ref="log" role="log" aria-live="polite" tabindex="0"><code data-ref="logCode"></code></pre>

      <div class="mini-columns">
        <div>
          <div class="mini-label">Validation checks</div>
          <ul class="mini-checks" data-ref="checks"></ul>
        </div>
        <div>
          <div class="mini-label">Deployment history</div>
          <ul class="mini-history" data-ref="history"></ul>
        </div>
      </div>

      <div class="mini-break">
        <div class="mini-label">Break the customer’s database</div>
        <div class="mini-break-buttons">
          <button type="button" class="mini-button" data-ref="dropTable">Drop a table</button>
          <button type="button" class="mini-button" data-ref="editMigration">Edit a shipped migration</button>
          <button type="button" class="mini-button" data-ref="offline">Take it offline</button>
        </div>
        <p class="mini-muted" data-ref="note" aria-live="polite"></p>
      </div>
    </div>`;

  const refs = {};

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const PILL_TONES = { healthy: 'positive', succeeded: 'positive', passed: 'positive', degraded: 'warning', failed: 'negative' };

  function pill(status) {
    return element('span', `mini-pill is-${PILL_TONES[status] || 'neutral'}`, sentence(status));
  }

  function renderList() {
    const focusedId = document.activeElement?.dataset?.env;
    refs.list.replaceChildren(...environments.map((env) => {
      const item = element('li');
      const button = element('button', env === selected ? 'is-selected' : '');
      button.type = 'button';
      button.dataset.env = env.id;
      button.setAttribute('aria-pressed', String(env === selected));
      button.append(
        element('span', 'mini-who', env.customer),
        element('span', 'mini-muted', `${env.name}, ${env.version || 'nothing deployed'}`),
        pill(env.status),
      );
      button.addEventListener('click', () => {
        selected = env;
        render();
      });
      item.append(button);
      return item;
    }));
    if (focusedId) refs.list.querySelector(`[data-env="${CSS.escape(focusedId)}"]`)?.focus();
  }

  function renderPipeline() {
    if (!selected) return;
    const run = selected.viewing;
    const steps = run ? run.steps : STEP_NAMES.map((name) => ({ name, status: 'pending', ms: null }));
    refs.steps.replaceChildren(...steps.map((step) => {
      const item = element('li', `is-${step.status}`, STEP_LABELS[step.name]);
      if (step.ms !== null) item.append(element('span', 'mini-ms', `${step.ms} ms`));
      return item;
    }));
  }

  let renderedRun = null;
  let renderedLines = 0;

  function renderLog() {
    if (!selected) return;
    const run = selected.viewing;
    if (run !== renderedRun) {
      refs.logCode.textContent = '';
      renderedRun = run;
      renderedLines = 0;
    }
    if (!run) {
      if (!refs.logCode.textContent) refs.logCode.textContent = 'Nothing has been deployed here yet.';
      return;
    }
    for (const line of run.logs.slice(renderedLines)) {
      const text = `${(line.step || '').padEnd(18)} ${line.message}\n`;
      if (line.level === 'error') refs.logCode.append(element('span', 'is-error', text));
      else refs.logCode.append(text);
    }
    renderedLines = run.logs.length;
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  function renderChecks() {
    const { checks } = selected;
    if (!checks.length) {
      refs.checks.replaceChildren(element('li', 'mini-muted', 'Checks run at the end of the first deployment.'));
      return;
    }
    refs.checks.replaceChildren(...checks.map((check) => {
      const item = element('li', check.passed ? '' : 'is-failed');
      item.append(
        element('span', 'mini-who', sentence(check.name)),
        pill(check.passed ? 'passed' : 'failed'),
        element('span', 'mini-detail', check.detail),
      );
      return item;
    }));
  }

  function renderHistory() {
    const { history } = selected;
    if (!history.length) {
      refs.history.replaceChildren(element('li', 'mini-muted', 'No deployments yet.'));
      return;
    }
    refs.history.replaceChildren(...history.slice(0, 6).map((run) => {
      const item = element('li');
      const button = element('button', run === selected.viewing ? 'is-selected' : '');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(run === selected.viewing));
      const strip = element('span', 'mini-strip');
      strip.setAttribute('aria-hidden', 'true');
      run.steps.forEach((step) => strip.append(element('i', `is-${step.status}`)));
      button.append(
        element('span', 'mini-who', `${run.from ? `${run.from} to ` : ''}${run.version}`),
        strip,
        pill(run.status),
      );
      button.addEventListener('click', () => {
        selected.viewing = run;
        render();
      });
      item.append(button);
      return item;
    }));
  }

  function renderFailure() {
    const run = selected.viewing;
    const failure = run?.failure;
    refs.failure.hidden = !failure;
    if (!failure) return;
    refs.failureCategory.textContent = sentence(failure.category);
    refs.failureSummary.textContent = failure.summary;
    refs.failureHint.textContent = failure.hint;
    refs.retry.hidden = run !== selected.history[0];
    refs.retry.disabled = selected.busy;
  }

  function renderControls() {
    const env = selected;
    const tables = env.db ? tableNames(env.db) : [];
    refs.title.textContent = `${env.customer} ${env.name}`;
    refs.running.textContent = env.version ? `Running ${env.version}` : 'Nothing deployed yet';
    refs.status.className = `mini-pill is-${PILL_TONES[env.status] || 'neutral'}`;
    refs.status.textContent = sentence(env.status);
    refs.deploy.disabled = env.busy;
    refs.deploy.textContent = env.busy ? 'Deploying' : 'Deploy';
    refs.runChecks.disabled = env.busy || !env.version;
    refs.dropTable.disabled = env.busy || !tables.includes('accounts') || env.offline;
    refs.editMigration.disabled = env.busy || !tables.includes('schema_migrations') || env.offline
      || Object.values(appliedMigrations(env.db)).includes('edited-by-hand');
    refs.offline.disabled = env.busy || !env.db;
    refs.offline.textContent = env.offline ? 'Bring it back online' : 'Take it offline';
    refs.note.textContent = env.note;
    refs.reset.disabled = environments.some((candidate) => candidate.busy);
  }

  function render() {
    if (!selected) return;
    renderList();
    renderControls();
    renderFailure();
    renderPipeline();
    renderLog();
    renderChecks();
    renderHistory();
  }

  // Controls -------------------------------------------------------------------

  function wire() {
    root.innerHTML = TEMPLATE;
    root.querySelectorAll('[data-ref]').forEach((node) => { refs[node.dataset.ref] = node; });

    RELEASES.forEach((release) => {
      const option = element('option', '', `${release.version}: ${release.notes}`);
      option.value = release.version;
      refs.release.append(option);
    });

    refs.deploy.addEventListener('click', () => deploy(selected, refs.release.value));

    refs.retry.addEventListener('click', () => {
      const run = selected.history[0];
      deploy(selected, run.version, { retryOf: run });
    });

    refs.runChecks.addEventListener('click', () => {
      const env = selected;
      const results = runChecks(env, releaseOf(env.version));
      env.status = results.every((result) => result.passed) ? 'healthy' : 'degraded';
      const failed = results.filter((result) => !result.passed).length;
      env.note = failed ? `DeployOps caught it: ${failed} of ${results.length} checks failed.` : 'All checks passed.';
      render();
    });

    refs.dropTable.addEventListener('click', () => {
      selected.db.run('DROP TABLE accounts');
      selected.note = 'The accounts table is gone. Run checks to see whether DeployOps notices.';
      render();
    });

    refs.editMigration.addEventListener('click', () => {
      selected.db.run("UPDATE schema_migrations SET checksum = 'edited-by-hand' WHERE name = '0001_core.sql'");
      selected.note = 'A migration that already shipped no longer matches its record. Run checks, or try to deploy.';
      render();
    });

    refs.offline.addEventListener('click', () => {
      selected.offline = !selected.offline;
      selected.note = selected.offline
        ? 'The database stopped answering. Run checks, or try to deploy.'
        : 'The database is answering again. A retry will pick up where it left off.';
      render();
    });

    refs.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = refs.name.value.trim();
      const environmentName = refs.envName.value;
      const slug = slugify(name);
      let problem = '';
      if (name.length < 2 || !/^[a-z]/.test(slug)) problem = 'Enter a company name that starts with a letter.';
      else if (environments.some((env) => env.id === `${slug}/${environmentName}`)) problem = `That customer already has ${environmentName}.`;
      else if (new Set(environments.map((env) => env.customer)).size >= MAX_CUSTOMERS && !environments.some((env) => env.customer === name)) problem = 'That’s plenty for a demo. Start over to add more.';
      refs.formProblem.textContent = problem;
      refs.formProblem.hidden = !problem;
      if (problem) return;
      const env = newEnvironment(name, environmentName);
      environments.push(env);
      selected = env;
      refs.name.value = '';
      render();
    });

    refs.reset.addEventListener('click', seed);
  }

  // Sample customers, deployed through the real pipeline with no pauses.
  async function seed() {
    generation += 1;
    environments.forEach((env) => env.db?.close());
    const samples = [
      ['Northline Freight', 'production', ['1.1.0']],
      ['Harbor Clinic Group', 'production', ['1.2.0']],
      ['Larkspur Foods', 'staging', []],
    ];
    environments = samples.map(([customer, name]) => newEnvironment(customer, name));
    selected = environments[0];
    renderedRun = null;
    refs.release.value = '1.2.0';
    for (let i = 0; i < samples.length; i += 1) {
      for (const version of samples[i][2]) await deploy(environments[i], version, { pace: 0 });
    }
    render();
  }

  function showProblem(message) {
    root.replaceChildren(element('p', 'mini-fallback', message));
  }

  function loadSqlJs() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'assets/vendor/sql-wasm.js';
      script.onload = () => window.initSqlJs({ locateFile: (file) => `assets/vendor/${file}` }).then(resolve, reject);
      script.onerror = reject;
      document.head.append(script);
    });
  }

  async function start() {
    if (window.location.protocol === 'file:') {
      showProblem('The live demo needs a web server, so it won’t run from a file opened directly. It works on the published site, or locally through python -m http.server.');
      return;
    }
    try {
      SQL = await loadSqlJs();
      const entries = await Promise.all(Object.entries(MIGRATIONS).map(async ([name, sql]) => [name, await sha256(sql)]));
      checksums = Object.fromEntries(entries);
    } catch {
      showProblem('The live demo couldn’t load in this browser. The screenshots on this page show the same screens.');
      return;
    }
    wire();
    await seed();
    root.dataset.ready = 'true';
  }

  // The database engine is about a megabyte, so only fetch it when the demo is close.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    }, { rootMargin: '900px 0px' });
    observer.observe(root);
  } else {
    start();
  }
})();
